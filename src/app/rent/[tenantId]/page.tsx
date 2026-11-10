'use client';
import { BuildingRules } from '@/components/rent/BuildingRules';
import { MyDocuments } from '@/components/rent/MyDocuments';
import { RenterPrep } from '@/components/rent/RenterPrep';
import { RenterFollowUps } from '@/components/rent/RenterFollowUps';
import { RenterMessages } from '@/components/rent/RenterMessages';
import { MyGiftCards } from '@/components/rent/MyGiftCards';
import { StaleCopyBanner } from '@/components/shared/StaleCopyBanner';
import { downscaleImageToDataUrl } from '@/lib/client-image';
import { getApps, initializeApp } from 'firebase/app';
import { getStorage, ref as storageRef } from 'firebase/storage';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { uploadImage } from '@/lib/upload-image';
import { firebaseConfig } from '@/firebase/config';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { credentialViews, stateLabel, CREDENTIAL_LABEL } from '@/lib/compliance';
import { useToast } from '@/hooks/use-toast';
import { Armchair, ChevronLeft, ChevronRight, Loader, Settings } from 'lucide-react';
import { biz, setBusinessName } from '@/components/rent/biz';
import { TAB_LABEL, VIEW_BACK, VIEW_PARENT, VIEW_TITLES, backMove, markSpot, needsTarget, placeRows, placesFor, pushSpot, setupRows, shownPlace, shownView, spotFromState, tabFor, type PortalTab, type RowGroupSpec, type Who } from '@/components/rent/portal-map';
import { ScreenContext, OpenScreenContext, type OpenScreen, fmtDate, fmtMoney, localISO } from '@/components/rent/shared';
import { MyBook, MyClientMessages, MyClients, TellMeWhen } from '@/components/rent/business';
import { GettingSetUp, MyBooks, MyBrand, MyHours, MyMemberships, MyNumber, MyPackages, MyPage, MyCampaigns, MyPayments, MyProfile, MyReconnect, MyReviews, MyServices } from '@/components/rent/setup';
import { RenterInbox } from '@/components/rent/RenterInbox';
import { RenterW9 } from '@/components/rent/RenterW9';
import { RenterTools } from '@/components/rent/RenterTools';
import { LoginFlow, MySwaps, RenterConcerns, RenterDocuments, RenterInterruptions, RenterLeave, RenterMaintenance, RenterThread, ResCard, STORE, TodayQuick, api } from '@/components/rent/studio';
import { RenterCard } from '@/components/rent/RenterCard';

// ─── Main page ────────────────────────────────────────────────────────────────
export default function RenterPortalPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const { toast } = useToast();

  const [session, setSession] = useState<{ token: string; expiresAt: number; name: string | null } | null>(() => {
    if (typeof window === 'undefined') return null;
    // Opened from a personal link: that link decides who's signed in (below), not a session left on this phone.
    if (new URLSearchParams(window.location.search).get('rt')) return null;
    try {
      const s = JSON.parse(localStorage.getItem(STORE(tenantId)) || 'null');
      return s && s.expiresAt > Date.now() ? s : null;
    } catch { return null; }
  });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [credBusy, setCredBusy] = useState<'license' | 'insurance' | null>(null);
  const [credDone, setCredDone] = useState<'license' | 'insurance' | null>(null);
  const [credOpen, setCredOpen] = useState<'license' | 'insurance' | null>(null);
  const [credForm, setCredForm] = useState({ expiry: '', carrier: '', policyNumber: '' });

  const saveSession = (s: { token: string; expiresAt: number; name: string | null } | null) => {
    if (s) localStorage.setItem(STORE(tenantId), JSON.stringify(s));
    else localStorage.removeItem(STORE(tenantId));
    setSession(s);
    setData(null);   // a new session (or none) never shows the last one's data
    // Signing out forgets where they were, the dots, a half-filled form and the business's name, so the next person on
    // this phone starts clean. Signing in keeps a link's place (applied once their portal loads, below).
    if (!s) { setTabRaw('today'); setView(null); setBadges({}); setCredOpen(null); setCredForm({ expiry: '', carrier: '', policyNumber: '' }); setBusinessName(''); }
  };

  // Magic link (?rt=TOKEN): the owner shared a personal sign-in link from
  // the renter's profile — exchange it for a session on arrival, then wipe
  // the token from the URL so it doesn't linger in history or share sheets.
  // This is the no-SMS path: it works before Twilio is configured.
  // A personal link always wins over a session already on this phone (two renters on one phone, or an expired one).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const rt = new URLSearchParams(window.location.search).get('rt');
    if (!rt) return;
    // Where the link points (?tab=rent from an autopay link, ?view=lease from a document) stays; the token goes.
    const keep = new URLSearchParams(window.location.search); keep.delete('rt');
    const rest = new URLSearchParams(); for (const k of ['tab', 'view']) { const v = keep.get(k); if (v) rest.set(k, v); }
    window.history.replaceState({}, '', window.location.pathname + (rest.toString() ? `?${rest.toString()}` : ''));
    (async () => {
      const d = await api({ action: 'token-login', tenantId, magicToken: rt });
      if (d.ok && d.token) { saveSession({ token: d.token, expiresAt: d.expiresAt, name: d.name || null }); return; }
      // The link didn't work: a session still on this phone carries on, otherwise they sign in below.
      try { const prev = JSON.parse(localStorage.getItem(STORE(tenantId)) || 'null'); if (prev && prev.expiresAt > Date.now()) { setSession(prev); return; } } catch { /* none */ }
      toast({ variant: 'destructive', title: 'Link didn’t work', description: d.error || 'Sign in with your phone or email below.' });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async (tok?: string) => {
    const token = tok || session?.token;
    if (!token) return;
    setLoading(true); setLoadError(null);
    const d = await api({ action: 'me', tenantId, token, today: localISO() });
    setLoading(false);
    if (d.ok) setData(d);
    else if (d.status === 401) saveSession(null);
    else { setLoadError(d.error || 'Something went wrong loading your portal.'); toast({ variant: 'destructive', title: 'Couldn’t load your info', description: d.error || 'Try again.' }); }
  }, [session?.token, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (session?.token && !data) refresh(); }, [session?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back from the card page (?cfCardSetup=1&cfSetupSession=&cfRenterId=): the card is stored on the server (once, however
  // often this runs), then the Rent tab shows it.
  useEffect(() => {
    if (typeof window === 'undefined' || !session?.token) return;
    const params = new URLSearchParams(window.location.search);
    const setup = params.get('cfSetupSession'); const rid = params.get('cfRenterId');
    if (params.get('cfCardSetup') !== '1' || !setup || !rid) return;
    window.history.replaceState({}, '', `${window.location.pathname}?tab=rent`);
    setTab('rent');
    (async () => {
      try {
        const r = await fetch(`/api/booths/setup-card?tenantId=${encodeURIComponent(tenantId)}&renterId=${encodeURIComponent(rid)}&session=${encodeURIComponent(setup)}`);
        const d: any = await r.json().catch(() => ({}));
        if (d?.ok) toast({ title: 'Card saved', description: `${d.cardBrand ? String(d.cardBrand).charAt(0).toUpperCase() + String(d.cardBrand).slice(1) : 'Your card'}${d.cardLast4 ? ` ending ${d.cardLast4}` : ''} is on file. You can turn on autopay below.` });
        else toast({ variant: 'destructive', title: 'Card not saved', description: d?.error || 'Try saving it again.' });
      } catch { toast({ variant: 'destructive', title: 'Card not saved', description: 'Try saving it again.' }); }
      refresh();
    })();
  }, [session?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Returning from Stripe Checkout (?cfInvoiceId=&cfSession=) → confirm the
  // payment server-side (idempotent), then clean the URL.
  useEffect(() => {
    if (typeof window === 'undefined' || !session?.token) return;
    const params = new URLSearchParams(window.location.search);
    const invoiceId = params.get('cfInvoiceId');
    const sessionId = params.get('cfSession');
    if (!invoiceId || !sessionId) return;
    window.history.replaceState({}, '', window.location.pathname);
    (async () => {
      const d = await api({ action: 'confirm-invoice', tenantId, token: session.token, invoiceId, sessionId });
      if (d.ok) toast({ title: 'Rent paid', description: 'Your receipt is on its way, and in Money under Payments and past bookings.' });
      else toast({ variant: 'destructive', title: 'Payment needs attention', description: d.error || 'If you were charged, let the business know. Nothing is lost.' });
      refresh();
    })();
  }, [session?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Returning from paying the security deposit (?cfDepositLease=&cfSession=): recorded on the server, once.
  useEffect(() => {
    if (typeof window === 'undefined' || !session?.token) return;
    const params = new URLSearchParams(window.location.search);
    const leaseId = params.get('cfDepositLease'); const sessionId = params.get('cfSession');
    if (!leaseId || !sessionId) return;
    window.history.replaceState({}, '', window.location.pathname);
    (async () => {
      const d = await api({ action: 'confirm-deposit', tenantId, token: session.token, leaseId, sessionId });
      if (d.ok) toast({ title: 'Deposit paid', description: 'It’s held for you. Your receipt is on its way.' });
      else if (d.pending) toast({ title: 'Payment on its way', description: d.error });
      else toast({ variant: 'destructive', title: d.extra ? 'Already paid' : 'Payment needs attention', description: d.error || 'If you were charged, let the business know. Nothing is lost.' });
      refresh();
    })();
  }, [session?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = localISO();
  const todays = useMemo(() => (data?.upcoming || []).filter((r: any) => r.startDate <= today && r.endDate >= today), [data, today]);
  const later = useMemo(() => (data?.upcoming || []).filter((r: any) => r.startDate > today), [data, today]);

  // Every booking section hangs off this one derived flag. A renter on their
  // own system keeps rent, documents and credits and loses the rest — and the
  // engine enforces the same thing server-side, so this is presentation
  // following truth rather than pretending.
  const booksHere = !!data?.provider && data?.bookingMode !== 'own';
  // ── One app: Today, Calendar, Clients, Money, Space (components/rent/portal-map) ──
  // Five places at the bottom (three when the renter doesn't take bookings
  // here). Each place is a short list; a row opens one screen with a way
  // back, and Business setup sits behind the gear. The bottom bar lights up
  // the place that has something waiting.
  // `linked`: signed in as their renter record, not only matched by phone or email (their W-9 needs it).
  const who: Who = { booksHere, hasRenter: !!data?.renter?.id, hasLease: !!data?.lease, swapsOn: booksHere && data?.swaps?.enabled !== false, linked: data?.renter?.linked !== false, addOns: data?.renter?.hasAddOns === true };
  const [tabAsked, setTabRaw] = useState<PortalTab>('today');
  // A screen opened from a place or from "Needs you": the exact thing, with a way back (null is the place itself).
  const [viewAsked, setView] = useState<string | null>(null);
  // What's shown is what was asked for, if this renter has it (a link to Calendar for someone who doesn't book here
  // lands on Today, never on a screen they can't use, not even for a moment).
  const tab: PortalTab = data ? shownPlace(tabAsked, who) : tabAsked === 'money' || tabAsked === 'space' ? tabAsked : 'today';
  const view = data ? shownView(viewAsked, who) : null;
  // What was asked for follows what's shown, so a screen hidden now can't reappear later on its own.
  useEffect(() => {
    if (!data) return;
    if (tabAsked !== tab) setTabRaw(tab);
    if (viewAsked !== view) setView(view);
  }, [data, tab, view, tabAsked, viewAsked]);
  // Each screen opened is a step in the browser's history (portal-map), so the phone's own back gesture closes it.
  // `backing` is true while a step back is on its way, so a quick second tap can't walk out of the portal.
  const backing = useRef(false);
  // Opening a screen, or going back from one, puts the focus on its heading, for anyone using a screen reader or a
  // keyboard. A tap on the bottom bar leaves the focus on the bar.
  const moved = useRef(false);
  const shownNow = useRef<{ tab: PortalTab; view: string | null }>({ tab, view });
  shownNow.current = { tab, view };
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const toTop = () => { try { window.scrollTo({ top: 0 }); } catch { /* fine */ } };
  const go = (t: PortalTab, v: string | null, how: 'step' | 'here', keepFocus = false) => {
    // Only somewhere this renter has; a screen they can't use isn't a step.
    const toTab = data ? shownPlace(t, who) : t;
    const toView = data ? shownView(v, who) : v;
    // A step back is worth having when they move to another screen, or (from a row on Today) to another place.
    const mode = how === 'step' && (toView || toTab !== tab) ? 'step' : 'here';
    try { if (mode === 'step') pushSpot(window.history, { tab, view }, { tab: toTab, view: toView }); else markSpot(window.history, { tab: toTab, view: toView }); } catch { /* fine */ }
    if (toView !== view && !keepFocus) moved.current = true;
    setTabRaw(toTab); setView(toView); toTop();
  };
  const setTab = (t: string) => go(tabFor(t), null, 'here', true);   // a tap on the bar keeps the focus on the bar
  const open = (v: string) => go(tab, v, 'step');
  // From inside a screen: another screen (in its own place), or a place itself.
  const openScreen: OpenScreen = (to) => go(to.tab || (to.view && VIEW_PARENT[to.view]) || tab, to.view || null, 'step');
  const back = () => {
    let move: 'history' | 'here' | 'wait' = 'here';
    try { move = backMove(window.history.state, backing.current); } catch { /* fine */ }
    if (move === 'wait') return;
    if (move === 'history') {
      backing.current = true;
      window.setTimeout(() => { backing.current = false; }, 1000);
      try { window.history.back(); return; } catch { backing.current = false; }
    }
    if (view) moved.current = true;
    setView(view ? VIEW_BACK[view] || null : null); toTop();
  };
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      backing.current = false;
      const spot = spotFromState(e.state);
      if ((spot?.view || null) !== shownNow.current.view) moved.current = true;
      if (spot) { setTabRaw(spot.tab); setView(spot.view); } else setView(null);
      toTop();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    try { headingRef.current?.focus({ preventScroll: true }); } catch { /* fine */ }
  }, [view]);
  // Opened from a link (e.g. "set up autopay" → ?tab=rent, or ?view=lease): that place or screen. The link is read
  // once (taking the screen off the address, so a refresh later doesn't reopen it) and kept until their portal has
  // loaded, so it still applies after they sign in.
  const linkTo = useRef<{ tab: PortalTab; view: string | null } | null>(null);
  const linkRead = useRef(false);
  useEffect(() => {
    if (linkRead.current) return;
    linkRead.current = true;
    try {
      const q = new URLSearchParams(window.location.search);
      const t = q.get('tab'); const v = q.get('view');
      if (v && VIEW_TITLES[v]) {
        linkTo.current = { tab: VIEW_PARENT[v] || (t ? tabFor(t) : 'today'), view: v };
        q.delete('view'); const rest = q.toString();
        window.history.replaceState({ ...(window.history.state || {}) }, '', window.location.pathname + (rest ? `?${rest}` : ''));
      } else if (t) linkTo.current = { tab: tabFor(t), view: null };
    } catch { /* fine */ }
  }, []);
  useEffect(() => {
    if (!data || !linkTo.current) return;
    const to = linkTo.current; linkTo.current = null;
    setTabRaw(to.tab); setView(to.view);
  }, [data]);
  // "Needs you" opens the thing itself, not just its place.
  const goFromToday = (t: string, kind?: string) => {
    const target = needsTarget(kind, t, who);
    go(target.tab, target.view, 'step');
  };
  const [badges, setBadges] = useState<Record<string, number>>({});
  // Coming back from a screen refreshes Today's list and the dots, so what they just did there is gone from them.
  const [freshen, setFreshen] = useState(0);
  const lastView = useRef<string | null>(null);
  // Screens that change what the portal itself shows (a signed lease, a new insurance date, time away, a setup change)
  // reload it too.
  // `dirty` remembers a visit to any of them until they're back on a place (setup screens close through Business setup).
  const dirty = useRef(false);
  useEffect(() => {
    const was = lastView.current; lastView.current = view;
    if (view && (['lease', 'rules', 'insurance', 'away', 'swaps'].includes(view) || view.startsWith('setup'))) dirty.current = true;
    if (!was || view) return;
    setFreshen((n) => n + 1);
    if (dirty.current) { dirty.current = false; void refresh(); }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  const rentDue = (data?.invoices || []).some((i: any) => i.status === 'due' || i.status === 'late');
  const openInvoices = useMemo(() => (data?.invoices || []).filter((i: any) => i.status === 'due' || i.status === 'late'), [data]);

  const doCheckIn = async (reservationId: string) => {
    if (!session) return;
    setActionBusy(true);
    const d = await api({ action: 'check-in', tenantId, token: session.token, reservationId, today: localISO() });
    setActionBusy(false);
    if (d.ok) {
      toast({
        title: 'You’re checked in',
        description: d.needsBalance
          ? `Reminder: ${fmtMoney(d.balanceDueCents)} balance is ${d.balanceMode === 'at_checkin' ? 'due now at the front desk' : 'payable in person'}.`
          : `Have a great day at ${biz()}.`,
      });
      refresh();
    } else if (d.status === 401) { saveSession(null); }
    else toast({ variant: 'destructive', title: 'Check-in didn’t go through', description: d.error || 'See the front desk.' });
  };

  const payInvoice = async (invoiceId: string) => {
    if (!session) return;
    setActionBusy(true);
    const d = await api({ action: 'pay-invoice', tenantId, token: session.token, invoiceId, returnUrl: window.location.href });
    setActionBusy(false);
    if (d.ok && d.url) { window.location.href = d.url; }
    else if (d.ok && d.alreadyPaid) { toast({ title: 'Already paid' }); refresh(); }
    else if (d.status === 401) { saveSession(null); }
    else toast({ variant: 'destructive', title: 'Couldn’t start payment', description: d.error || 'You can always pay at the front desk.' });
  };

  const payDeposit = async (leaseId: string) => {
    if (!session) return;
    setActionBusy(true);
    const d = await api({ action: 'pay-deposit', tenantId, token: session.token, leaseId, returnUrl: window.location.href });
    setActionBusy(false);
    if (d.ok && d.url) { window.location.href = d.url; }
    else if (d.ok && d.alreadyPaid) { toast({ title: 'Deposit already paid' }); refresh(); }
    else if (d.status === 401) { saveSession(null); }
    else toast({ variant: 'destructive', title: 'Couldn’t start payment', description: d.error || 'You can pay your deposit at the front desk.' });
  };

  const requestReschedule = async (reservationId: string) => {
    if (!session) return;
    setActionBusy(true);
    const d = await api({ action: 'request-reschedule', tenantId, token: session.token, reservationId });
    setActionBusy(false);
    if (d.ok) {
      toast({ title: 'Request sent', description: `${biz(true)} will reach out to move your booking.` });
      refresh();
    } else if (d.status === 401) { saveSession(null); }
    else toast({ variant: 'destructive', title: 'Couldn’t send request', description: d.error || 'Try again.' });
  };

  const doCheckOut = async (reservationId: string) => {
    if (!session) return;
    setActionBusy(true);
    const d = await api({ action: 'check-out', tenantId, token: session.token, reservationId });
    setActionBusy(false);
    if (d.ok) {
      const desc = d.overageDueCents > 0
        ? `${fmtMoney(d.overageDueCents)} for ${d.overageMinutes} extra minutes will be settled by ${biz()}.`
        : d.potentialCreditCents > 0
          ? `${fmtMoney(d.potentialCreditCents)} of unused time was sent to ${biz()} to review for credit.`
          : 'All settled — see you next time.';
      toast({ title: 'Checked out', description: desc });
      refresh();
    } else if (d.status === 401) { saveSession(null); }
    else toast({ variant: 'destructive', title: 'Check-out didn’t go through', description: d.error || 'See the front desk.' });
  };

  // Before sign-in the business isn't known yet (and a name from another business's portal on this phone mustn't show).
  if (!session) { setBusinessName(''); return <LoginFlow tenantId={tenantId} onSession={s => { saveSession(s); refresh(s.token); }} />; }

  const firstName = (data?.name || session.name || '').split(' ')[0] || 'there';
  const business = String(data?.studioName || data?.tenant?.name || '').trim();
  setBusinessName(business);
  const renterBrand = String(data?.renter?.businessName || '').trim();
  const hour = new Date().getHours();
  const hello = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${firstName}`;
  const headings: Record<PortalTab, [string, string]> = {
    today: [renterBrand ? `${renterBrand} · at ${business || 'your space'}` : business, hello],
    calendar: [renterBrand || firstName, 'Your calendar'],
    clients: [renterBrand || firstName, 'Your clients'],
    money: [business ? `Your business, and rent with ${business}` : 'Your business, and your rent', 'Money'],
    space: [data?.lease?.boothName && business ? `${data.lease.boothName} at ${business}` : business, 'Your space'],
  };
  const [sub, title] = view ? [VIEW_PARENT[view] ? TAB_LABEL[VIEW_PARENT[view]] : '', view === 'setup' && !booksHere ? 'Settings' : VIEW_TITLES[view] || ''] : headings[tab];
  const token = session.token;
  const hasRenter = who.hasRenter;
  const creds = credentialViews(data?.renter, { bookingPageSettings: { automationRules: data?.compliance || {} } }, new Date().toISOString().slice(0, 10));
  const credLine = creds.length === 0 ? 'Nothing required' : creds.every((v) => v.state === 'ok') ? 'All current' : creds.some((v) => v.state === 'expired' || (v.state === 'missing' && v.required)) ? 'Something is missing or expired' : creds.some((v) => v.state === 'expiring') ? 'Something expires soon' : 'Add yours';
  const credWarn = creds.some((v) => v.state === 'expired' || v.state === 'expiring' || (v.state === 'missing' && v.required));
  const lease: any = data?.lease || null;
  const leaseLine = !lease ? 'Your lease and documents' : lease.status === 'pending_signature' ? 'Waiting for your signature' : lease.status === 'active' ? 'Signed' : String(lease.status || '').replace(/_/g, ' ');

  // ── The screens a row opens ────────────────────────────────────────────────
  const screen = (v: string): React.ReactNode => {
    if (!token) return null;
    switch (v) {
      case 'notices': return (<div className="space-y-8"><RenterInbox tenantId={tenantId} token={token} businessName={business || 'the business'} /><RenterThread tenantId={tenantId} token={token} studioName={business || 'the business'} /></div>);
      case 'repairs': return <RenterMaintenance tenantId={tenantId} token={token} />;
      case 'concerns': return <RenterConcerns tenantId={tenantId} token={token} />;
      case 'lease': return (<div className="space-y-8"><RenterDocuments tenantId={tenantId} token={token} />{!booksHere && hasRenter && <ScreenContext.Provider value={false}><MyDocuments tenantId={tenantId} token={token} booksHere={false} /></ScreenContext.Provider>}</div>);
      case 'rules': return <BuildingRules tenantId={tenantId} token={token} name={data?.renter?.name || null} />;
      case 'insurance': return renderCreds();
      case 'w9': return <RenterW9 tenantId={tenantId} token={token} renterId={String(data?.renter?.id || '')} onSaved={() => refresh()} />;
      case 'tools': return <RenterTools tenantId={tenantId} token={token} />;
      case 'away': return <RenterLeave tenantId={tenantId} token={token} />;
      case 'closures': return <RenterInterruptions tenantId={tenantId} token={token} />;
      case 'swaps': return <MySwaps data={data} tenantId={tenantId} token={token} onChanged={() => refresh()} />;
      case 'history': return (<div className="space-y-8">
        {(data?.payments || []).length > 0 && (
          <section className="space-y-2">
            <h2 className="px-1 text-[14px] font-semibold text-[#6d7075]">Payments</h2>
            <ul className="divide-y divide-[#ececee] overflow-hidden rounded-2xl border border-[#ececee] bg-white">
              {(data.payments || []).map((p: any) => (
                <li key={p.id || p.date + p.description} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[15px] text-[#16171a]">{p.description || p.category}</p>
                    <p className="text-[13px] text-[#6d7075]">{p.date ? fmtDate(String(p.date).slice(0, 10)) : ''}</p>
                  </div>
                  <p className={cn('shrink-0 text-[15px] font-medium tabular-nums', p.type === 'reversal' ? 'text-[#6d7075]' : 'text-[#16171a]')}>
                    {p.type === 'reversal' ? '−' : ''}${Number(p.amount || 0).toFixed(2)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
        {(data?.past || []).length > 0 && (
          <section className="space-y-2">
            <h2 className="px-1 text-[14px] font-semibold text-[#6d7075]">Past space bookings</h2>
            <ul className="divide-y divide-[#ececee] overflow-hidden rounded-2xl border border-[#ececee] bg-white">
              {(data.past || []).map((r: any) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[15px] text-[#16171a]">{r.boothName}</p>
                    <p className="text-[13px] text-[#6d7075]">{fmtDate(r.startDate)}</p>
                  </div>
                  <span className="shrink-0 text-[13px] text-[#6d7075]">{(() => { const t = String(r.status || '').replace(/_/g, ' ').replace('cancelled', 'canceled'); return t.charAt(0).toUpperCase() + t.slice(1); })()}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!(data?.payments || []).length && !(data?.past || []).length && <p className="rounded-2xl border border-[#ececee] bg-white px-4 py-4 text-[14px] text-[#6d7075]">Nothing yet.</p>}
      </div>);
      case 'books': return <MyBooks tenantId={tenantId} token={token} />;
      case 'payouts': return <MyPayments data={data} tenantId={tenantId} token={token} />;
      case 'followups': return <RenterFollowUps tenantId={tenantId} token={token} />;
      case 'campaigns': return <MyCampaigns data={data} tenantId={tenantId} token={token} />;
      case 'reconnect': return <MyReconnect tenantId={tenantId} token={token} />;
      case 'giftcards': return <MyGiftCards tenantId={tenantId} token={token} />;
      case 'clientdocs': return <MyDocuments tenantId={tenantId} token={token} booksHere />;
      case 'setup': return renderSetup();
      case 'setup:page': return (<div className="space-y-8"><MyBrand tenantId={tenantId} token={token} renterId={String(data?.renter?.id || '')} /><MyPage tenantId={tenantId} token={token} renterId={String(data?.renter?.id || '')} /><MyReviews tenantId={tenantId} token={token} /></div>);
      case 'setup:services': return <MyServices data={data} tenantId={tenantId} token={token} onChanged={() => refresh()} />;
      case 'setup:hours': return <MyHours data={data} tenantId={tenantId} token={token} onChanged={() => refresh()} />;
      case 'setup:packages': return (<div className="space-y-8"><MyPackages data={data} tenantId={tenantId} token={token} /><MyMemberships data={data} tenantId={tenantId} token={token} /></div>);
      case 'setup:profile': return <MyProfile data={data} tenantId={tenantId} token={token} onChanged={() => refresh()} />;
      case 'setup:number': return <MyNumber data={data} tenantId={tenantId} token={token} onChanged={() => refresh()} />;
      case 'setup:messages': return <MyClientMessages tenantId={tenantId} token={token} />;
      case 'setup:alerts': return <TellMeWhen tenantId={tenantId} token={token} />;
      case 'setup:payments': return <MyPayments data={data} tenantId={tenantId} token={token} />;
      default: return null;
    }
  };

  // Insurance and license: what's on file, what's needed, and adding a renewed one. Amber for anything to sort out.
  const renderCreds = () => (
    <section className="space-y-3">
      {credentialViews(data?.renter, { bookingPageSettings: { automationRules: data?.compliance || {} } }, new Date().toISOString().slice(0, 10)).map((v) => {
        const kind = v.kind;
        const needs = v.state === 'expired' || v.state === 'expiring' || (v.state === 'missing' && v.required);
        return (
          <div key={kind} className="space-y-3 rounded-2xl border border-[#ececee] bg-white p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[15px] font-medium text-[#16171a]">{CREDENTIAL_LABEL[kind]}</p>
              <span className={cn('shrink-0 text-[13px] font-medium', v.state === 'ok' ? 'text-[#1f7a4d]' : needs ? 'text-[#b45309]' : 'text-[#6d7075]')}>{stateLabel(v)}</span>
            </div>
            {kind === 'insurance' && (v.carrier || v.policyNumber) && <p className="text-[14px] text-[#6d7075]">{v.carrier}{v.carrier && v.policyNumber ? ' · ' : ''}{v.policyNumber ? `Policy ${v.policyNumber}` : ''}</p>}
            {v.state === 'missing' && v.required && <p className="text-[14px] text-[#b45309]">{biz(true)} requires this on file to rent here.</p>}
            {v.docUrl && <a href={v.docUrl} target="_blank" rel="noopener" className="inline-flex min-h-[44px] items-center text-[14px] font-medium text-[#16171a] underline underline-offset-2">See the copy on file</a>}
            {credOpen === kind ? (
              <div className="space-y-2">
                <label className="block text-[13px] text-[#6d7075]">Expiry date
                  <input type="date" value={credForm.expiry} onChange={(e) => setCredForm((f) => ({ ...f, expiry: e.target.value }))} className="mt-1 h-11 w-full rounded-xl border border-[#ececee] bg-white px-3 text-[15px] text-[#16171a]" />
                </label>
                {kind === 'insurance' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input value={credForm.carrier} onChange={(e) => setCredForm((f) => ({ ...f, carrier: e.target.value.slice(0, 120) }))} aria-label="Insurance carrier" placeholder="Carrier" className="h-11 min-w-0 rounded-xl border border-[#ececee] bg-white px-3 text-[15px] text-[#16171a] placeholder:text-[#6d7075]" />
                    <input value={credForm.policyNumber} onChange={(e) => setCredForm((f) => ({ ...f, policyNumber: e.target.value.slice(0, 80) }))} aria-label="Policy number" placeholder="Policy number" className="h-11 min-w-0 rounded-xl border border-[#ececee] bg-white px-3 text-[15px] text-[#16171a] placeholder:text-[#6d7075]" />
                  </div>
                )}
                <p className="text-[13px] leading-snug text-[#6d7075]">Enter the expiry date exactly as it appears on the document, then attach a photo of it. {biz(true)} is told automatically.</p>
                <div className="flex gap-2">
                  <label className={cn('flex h-11 flex-1 cursor-pointer items-center justify-center rounded-full bg-[#16171a] text-[15px] font-medium text-white', (credBusy === kind || !credForm.expiry) && 'pointer-events-none opacity-50')}>
                    {credBusy === kind ? 'Uploading…' : 'Attach photo and save'}
                    <input type="file" accept="image/*" capture="environment" className="hidden" disabled={!!credBusy || !credForm.expiry}
                      onChange={async (e) => {
                        const f = e.target.files?.[0]; e.target.value = '';
                        if (!f || !session) return;
                        setCredBusy(kind);
                        try {
                          const dataUrl: string = await downscaleImageToDataUrl(f, { maxDim: 1600 });
                          const d = await api({ action: 'upload-credential', tenantId, token: session.token, kind, photoData: dataUrl, expiry: credForm.expiry, carrier: credForm.carrier, policyNumber: credForm.policyNumber });
                          if (d.ok) { setCredDone(kind); setCredOpen(null); setCredForm({ expiry: '', carrier: '', policyNumber: '' }); toast({ title: 'On file', description: `${biz(true)} has been told.` }); void refresh(); }
                          else toast({ variant: 'destructive', title: 'Upload failed', description: d.error || 'Try again.' });
                        } catch { toast({ variant: 'destructive', title: 'Upload failed', description: 'Try again.' }); }
                        finally { setCredBusy(null); }
                      }} />
                  </label>
                  <button type="button" onClick={() => setCredOpen(null)} className="h-11 rounded-full border border-[#ececee] bg-white px-4 text-[15px] font-medium text-[#16171a]">Cancel</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => { setCredOpen(kind); setCredForm({ expiry: v.expiry || '', carrier: v.carrier || '', policyNumber: v.policyNumber || '' }); }}
                className="h-11 w-full rounded-full border border-[#ececee] bg-white text-[15px] font-medium text-[#16171a] hover:bg-[#f5f5f7]">
                {credDone === kind ? 'Uploaded · update again' : v.docUrl ? 'Upload a renewed one' : v.state === 'ok' || v.state === 'expiring' ? 'Add a photo of it' : `Add ${kind === 'insurance' ? 'insurance' : 'license'}`}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );

  // Each row's words. Which rows a renter sees, and in what order, is portal-map's (placeRows, setupRows).
  const waiting = (...kinds: string[]) => kinds.reduce((n, k) => n + (badges[`k:${k}`] || 0), 0) || undefined;
  const rowFor = (v: string): { title: string; sub?: string; badge?: number; warn?: boolean } => {
    switch (v) {
      case 'notices': return { title: 'Messages and notices', sub: `Everything from ${business || 'the business'}, kept word for word`, badge: waiting('notice', 'message') };
      case 'repairs': return { title: 'Something broken?', sub: 'Report a repair and follow it' };
      case 'concerns': return { title: 'Raise a concern', sub: 'Private, with a reference number' };
      case 'lease': return { title: 'Lease and documents', sub: waiting('document') ? 'Something to read or sign' : leaseLine, warn: lease?.status === 'pending_signature' || !!waiting('document'), badge: waiting('document') };
      case 'rules': return { title: 'House rules', sub: waiting('rules') ? 'Something to sign' : `What ${business || 'the business'} asks of everyone`, warn: !!waiting('rules'), badge: waiting('rules') };
      case 'insurance': return { title: 'Insurance and license', sub: credLine, warn: credWarn };
      case 'w9': return { title: 'Tax form (W-9)', sub: data?.renter?.w9OnFile ? 'On file' : 'For year-end tax forms' };
      case 'tools': return { title: 'What comes with your space', sub: 'What’s included, and what you can add' };
      case 'away': return { title: 'Time away', sub: 'Ask for time off, and see what happens to rent' };
      case 'swaps': return { title: 'Swap days', sub: 'Trade time with another renter' };
      case 'closures': return { title: 'Closures', sub: 'When the space couldn’t be used, and what you were credited' };
      case 'history': return { title: 'Payments and past bookings', sub: 'Everything you’ve paid, and your past space bookings' };
      case 'books': return { title: 'Earnings and expenses', sub: 'Earned, rent, expenses and what’s left, by month' };
      case 'payouts': return { title: 'Payouts', sub: 'Where your money lands' };
      case 'followups': return { title: 'Follow-ups', sub: 'Who to check in with, and a text ready to send' };
      case 'campaigns': return { title: 'Campaigns', sub: 'One message to a group of your clients' };
      case 'reconnect': return { title: 'Win back', sub: 'Clients you haven’t seen in a while' };
      case 'giftcards': return { title: 'Gift cards', sub: 'Sell them, and take them in person' };
      case 'clientdocs': return { title: 'Client documents', sub: 'Forms and files for your clients, private to you' };
      case 'setup:page': return { title: 'Your booking page', sub: 'Look, about you, photos, reviews and links' };
      case 'setup:services': return { title: 'Services', sub: 'Your menu, prices and lengths' };
      case 'setup:hours': return { title: 'Hours', sub: 'When clients can book you' };
      case 'setup:profile': return { title: 'Your profile', sub: 'Your name, photo and a line about you' };
      case 'setup:payments': return { title: 'Card payments', sub: 'Deposits and payments go to your own account' };
      case 'setup:packages': return { title: 'Packages and memberships', sub: tab === 'clients' ? 'Set them up in Business setup' : 'Prepaid bundles and monthly plans' };
      case 'setup:messages': return { title: 'Client messages', sub: 'Confirmations, reminders and thank-yous in your name' };
      case 'setup:number': return { title: 'Your number', sub: 'The number clients text' };
      case 'setup:alerts': return { title: 'Your own alerts', sub: 'How you hear about new bookings and changes' };
      default: return { title: VIEW_TITLES[v] || v };
    }
  };
  const groupsOf = (groups: RowGroupSpec[]) => groups.map((g) => (
    <RowGroup key={g.id} title={g.id === 'with' ? (business ? `With ${business}` : 'Your rent') : g.title || undefined}>
      {g.views.map((v) => { const r = rowFor(v); return <Row key={v} title={r.title} sub={r.sub} badge={r.badge} warn={r.warn} onClick={() => open(v)} />; })}
    </RowGroup>
  ));
  // The space booked by the day or hour: on Calendar for those who book here, on Space for everyone else.
  const spaceBookings = (
    <section className="space-y-2">
      <h2 className="px-1 text-[14px] font-semibold text-[#6d7075]">Your space bookings</h2>
      {later.length === 0
        ? <p className="rounded-2xl border border-[#ececee] bg-white px-4 py-4 text-[14px] text-[#6d7075]">Nothing booked ahead.</p>
        : <div className="space-y-3">{later.map((r: any) => <ResCard key={r.id} r={r} isToday={false} onRequestReschedule={requestReschedule} busy={actionBusy} />)}</div>}
      {data?.rebookUrl && (
        <a href={data.rebookUrl} className="flex h-11 w-full items-center justify-center gap-1 rounded-full border border-[#ececee] bg-white text-[15px] font-medium text-[#16171a] hover:bg-[#f5f5f7]">
          Book the space again <ChevronRight className="h-4 w-4" />
        </a>
      )}
    </section>
  );

  // Business setup (from the header): how clients find and book them, getting paid, keeping in touch. Sign out sits
  // at the end for everyone.
  const renderSetup = () => (
    <div className="space-y-6">
      {groupsOf(setupRows(who))}
      <RowGroup title="This device">
        <Row title={loading ? 'Refreshing…' : 'Refresh'} sub="Load the latest" onClick={() => refresh()} />
        <Row title="Sign out" sub="You’ll need a new code to come back" onClick={() => saveSession(null)} />
      </RowGroup>
    </div>
  );

  const card = 'overflow-hidden rounded-2xl border border-[#ececee] bg-white';
  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#16171a]">
      <header className="sticky top-0 z-30 border-b border-[#ececee] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          {view && (
            <button type="button" onClick={back} aria-label="Back"
              className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#16171a] hover:bg-[#f5f5f7]">
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            {sub && <p className="truncate text-[13px] text-[#6d7075]">{sub}</p>}
            <h1 ref={headingRef} tabIndex={-1} className={cn('font-semibold tracking-tight outline-none', view ? 'text-[20px] leading-tight' : 'truncate text-[22px]')}>{title}</h1>
          </div>
          {view !== 'setup' && (
            <button type="button" onClick={() => open('setup')} aria-label={booksHere ? 'Business setup' : 'Settings'}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#f5f5f7] text-[#16171a] hover:bg-[#ececee]">
              <Settings className="h-5 w-5" />
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 pb-32 pt-4">
        <StaleCopyBanner />
        {loading && !data ? (
          <div className="flex flex-col items-center gap-3 py-24 text-[#6d7075]">
            <Loader className="h-6 w-6 animate-spin" />
            <p className="text-[14px]">Loading…</p>
          </div>
        ) : !data && loadError ? (
          // A failed load says so, with the real reason, instead of spinning.
          <div className="mx-auto max-w-sm space-y-3 rounded-2xl border border-[#ececee] bg-white p-5 text-center">
            <p className="text-[15px] font-semibold">Your portal didn’t load</p>
            <p className="break-words text-[13px] text-[#b45309]">{loadError}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => refresh()} className="h-11 flex-1 rounded-full bg-[#16171a] text-[14px] font-medium text-white">Try again</button>
              <button type="button" onClick={() => saveSession(null)} className="h-11 flex-1 rounded-full border border-[#ececee] bg-white text-[14px] font-medium">Sign in again</button>
            </div>
          </div>
        ) : !data ? (
          <div className="flex flex-col items-center gap-3 py-24 text-[#6d7075]">
            <Loader className="h-6 w-6 animate-spin" />
            <p className="text-[14px]">Loading…</p>
          </div>
        ) : (
          <div>
            {token && <div className={!view && tab === 'today' ? 'mb-8' : ''}><TodayQuick data={data} booksHere={booksHere} onGo={goFromToday} tenantId={tenantId} token={token} onBadges={setBadges} visible={!view && tab === 'today'} refreshKey={freshen} /></div>}

            {view ? (
              <OpenScreenContext.Provider value={openScreen}><ScreenContext.Provider value><div className="space-y-8">{screen(view)}</div></ScreenContext.Provider></OpenScreenContext.Provider>
            ) : tab === 'today' ? (
              <div className="space-y-8">
                {todays.length > 0 && (
                  <section className="space-y-3">
                    <h2 className="px-1 text-[14px] font-semibold text-[#6d7075]">Your space today</h2>
                    {todays.map((r: any) => (
                      <ResCard key={r.id} r={r} isToday onCheckIn={doCheckIn} onCheckOut={doCheckOut} busy={actionBusy} />
                    ))}
                  </section>
                )}
                {token && <GettingSetUp data={data} tenantId={tenantId} token={token} onChanged={() => refresh()} onOpen={(t, v) => go(tabFor(t), v, 'step')} />}
                {token && hasRenter && !booksHere && <RenterMessages tenantId={tenantId} token={token} always={false} />}
                {session?.token && data?.renter?.id && !booksHere && (
                  <section className="space-y-2">
                    <h2 className="px-1 text-[14px] font-semibold text-[#6d7075]">Bookings</h2>
                    <div className="rounded-2xl border border-[#ececee] bg-white p-4">
                      {data?.bookingMode === 'own' ? (
                        <>
                          <p className="text-[15px] font-medium">You take your own bookings</p>
                          <p className="mt-1 text-[14px] leading-relaxed text-[#6d7075]">
                            Your menu, calendar and clients live in your own system, so this portal keeps to rent, documents and messages.
                            If you ever want to run bookings from here instead, ask {biz()} to switch it on.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-[15px] font-medium">Bookings aren’t on for you here yet</p>
                          <p className="mt-1 text-[14px] leading-relaxed text-[#6d7075]">
                            Once {biz()} turns them on, this portal adds your service menu, your hours, a booking link of your own,
                            your calendar, your client list and your payouts. Ask them to turn it on.
                          </p>
                        </>
                      )}
                    </div>
                  </section>
                )}
              </div>
            ) : tab === 'calendar' ? (
              <div className="space-y-8">
                {booksHere && token && <MyBook data={data} tenantId={tenantId} token={token} />}
                {booksHere && token && hasRenter && <RenterPrep tenantId={tenantId} token={token} />}
                {todays.length > 0 && (
                  <section className="space-y-3">
                    <h2 className="px-1 text-[14px] font-semibold text-[#6d7075]">Your space today</h2>
                    {todays.map((r: any) => (
                      <ResCard key={r.id} r={r} isToday onCheckIn={doCheckIn} onCheckOut={doCheckOut} busy={actionBusy} />
                    ))}
                  </section>
                )}
                {spaceBookings}
              </div>
            ) : tab === 'clients' ? (
              <div className="space-y-8">
                {booksHere && token && hasRenter && <RenterMessages tenantId={tenantId} token={token} always />}
                {booksHere && token && <MyClients tenantId={tenantId} token={token} />}
                {groupsOf(placeRows('clients', who))}
              </div>
            ) : tab === 'money' ? (
              <div className="space-y-8">
                {data?.lease && (
                  <section className="space-y-2">
                    <h2 className="px-1 text-[14px] font-semibold text-[#6d7075]">Your rent</h2>
                    <div className="space-y-3 rounded-2xl border border-[#ececee] bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[15px] font-medium">{data.lease.boothName || 'Your space'}</p>
                          <p className="text-[13px] text-[#6d7075]">
                            {fmtMoney(data.lease.rentAmountCents)} a {({ daily: 'day', weekly: 'week', biweekly: 'two weeks', monthly: 'month' } as Record<string, string>)[String(data.lease.frequency || 'monthly')] || 'month'}
                          </p>
                        </div>
                        {data.lease.status === 'pending_signature'
                          ? <button type="button" onClick={() => go('space', 'lease', 'step')} className="inline-flex h-11 shrink-0 items-center rounded-full border border-[#ececee] px-4 text-[14px] font-medium text-[#b45309]">Sign to start</button>
                          : <span className={cn('shrink-0 text-[13px] font-medium', openInvoices.length ? 'text-[#b45309]' : 'text-[#1f7a4d]')}>{openInvoices.some((i: any) => i.status === 'late') ? 'Late' : openInvoices.length > 0 ? 'Due' : 'All paid'}</span>}
                      </div>
                      {(() => { const o: any = data.rentOutlook; if (!o || (o.creditCents <= 0 && !o.nextDue)) return null; const first = o.nextDue ? fmtDate(o.nextDue) : null; return (
                        <div className="space-y-1 rounded-xl bg-[#f5f5f7] p-3 text-[13px] leading-snug">
                          {o.creditCents > 0 && <p className="text-[#1f7a4d]">{fmtMoney(o.creditCents)} credit on your account{o.credits?.length > 1 ? ` (${o.credits.map((c: any) => `${c.label} ${fmtMoney(c.cents)}`).join(' · ')})` : o.credits?.[0] ? `, ${o.credits[0].label.toLowerCase()}` : ''}</p>}
                          {o.nextDue && <p>{o.nextAfterCreditsCents <= 0 ? `Your ${first} rent is covered${o.creditLeftAfterCents > 0 ? `, with ${fmtMoney(o.creditLeftAfterCents)} credit left after it` : ''}.`
                            : `Your ${first} rent will be ${fmtMoney(o.nextAfterCreditsCents)}${o.nextAfterCreditsCents < o.nextRentCents ? ` (${fmtMoney(o.nextRentCents)} less ${fmtMoney(o.nextRentCents - o.nextAfterCreditsCents)} credit)` : ''}.`}
                            {o.autopayOn ? (o.nextAfterCreditsCents > 0 ? ` Autopay will take it on ${first}.` : ' Autopay has nothing to take.') : ''}</p>}
                          {o.owedNowCents > 0 && o.creditCents > 0 && <p className="text-[#6d7075]">Credit comes off your next rent, not what’s owed now.</p>}
                        </div>); })()}
                      {openInvoices.map((i: any) => (
                        <div key={i.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#f3d9bd] bg-[#fdf6ee] p-3">
                          <div className="min-w-0">
                            <p className="text-[15px] font-medium text-[#16171a]">
                              {fmtMoney(Math.max(0, i.amountCents + i.lateFeeCents - (i.paidCents || 0)))}
                              {i.lateFeeCents > 0 && <span className="text-[13px] font-normal text-[#6d7075]"> (with a {fmtMoney(i.lateFeeCents)} late fee)</span>}
                              {(i.paidCents || 0) > 0 && <span className="text-[13px] font-normal text-[#6d7075]"> ({fmtMoney(i.paidCents)} already paid)</span>}
                            </p>
                            <p className="text-[13px] text-[#b45309]">{i.status === 'late' ? 'Was due' : 'Due'} {fmtDate(i.dueDate)}</p>
                            {i.creditAppliedCents > 0 && <p className="text-[12px] text-[#1f7a4d]">{fmtMoney(i.creditAppliedCents)} credit applied{i.grossCents ? `, was ${fmtMoney(i.grossCents)}` : ''}{i.creditNote ? ` · ${i.creditNote}` : ''}</p>}
                          </div>
                          <button onClick={() => payInvoice(i.id)} disabled={actionBusy}
                            className="h-11 shrink-0 rounded-full bg-[#16171a] px-5 text-[14px] font-medium text-white disabled:opacity-50">
                            {actionBusy ? 'Opening…' : 'Pay now'}
                          </button>
                        </div>
                      ))}
                      {data.lease.deposit && (() => {
                        const d: any = data.lease.deposit;
                        // What they'd get back is "held for you"; a deduction is money kept, said as kept.
                        const kept = (d.deductions || []).reduce((n: number, x: any) => n + (Number(x.cents) || 0), 0);
                        const line = d.status === 'not_collected' ? `${fmtMoney(d.agreedCents)} due`
                          : [d.returnableCents > 0 ? `${fmtMoney(d.returnableCents)} held for you` : '', d.refundedCents > 0 ? `${fmtMoney(d.refundedCents)} returned` : '', d.refundingCents > 0 ? `${fmtMoney(d.refundingCents)} on its way to your card` : '',
                            d.appliedCents > 0 ? `${fmtMoney(d.appliedCents)} applied to what you owed` : '', kept > 0 ? `${fmtMoney(kept)} kept` : ''].filter(Boolean).join(' · ') || 'Settled';
                        const stillOpen = d.status === 'not_collected' || d.returnableCents > 0;
                        return (
                          <div className="rounded-xl border border-[#ececee] bg-white p-3 text-[#16171a]">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[14px] font-medium">Security deposit</p>
                                <p className="text-[13px] text-[#6d7075]">{line}</p>
                              </div>
                              {d.canPayOnline && (
                                <button type="button" onClick={() => payDeposit(data.lease.id)} disabled={actionBusy}
                                  className="h-11 shrink-0 rounded-xl bg-[#16171a] px-4 text-[13px] font-medium text-white disabled:opacity-50">
                                  {actionBusy ? 'Opening…' : 'Pay deposit'}
                                </button>
                              )}
                            </div>
                            {d.deductions?.length > 0 && (
                              <ul className="mt-2 space-y-1 border-t border-[#ececee] pt-2">
                                {d.deductions.map((x: any, i: number) => (
                                  <li key={i} className="flex justify-between gap-3 text-[12px]"><span className="min-w-0 text-[#6d7075]">{x.reason} · {fmtDate(x.at)}</span><span className="shrink-0 tabular-nums">−{fmtMoney(x.cents)}</span></li>
                                ))}
                              </ul>
                            )}
                            {stillOpen && (
                              <p className="mt-2 text-[12px] text-[#6d7075]">
                                {d.status === 'not_collected' && !d.canPayOnline ? 'Pay it at the front desk. ' : ''}
                                {d.refundable ? `Held for you, not spent, and returned as your rental agreement sets out.${d.conditions ? ` ${String(d.conditions).replace(/\.?$/, '.')}` : ''}` : 'Your rental agreement says this deposit isn’t refundable.'}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                      <p className="text-[12px] text-[#6d7075]">Paying by cash or check at the front desk? It shows here too.</p>
                    </div>
                  </section>
                )}
                {session?.token && data?.renter?.id && (
                  <RenterCard tenantId={tenantId} token={session.token} renter={data.renter} autopayOn={data?.rentOutlook?.autopayOn === true}
                    hasLease={!!data?.lease} waitingSignature={data?.rentOutlook?.waitingSignature === true} onChanged={refresh}
                    onToast={(t) => toast({ title: t.title, description: t.description, ...(t.bad ? { variant: 'destructive' as const } : {}) })} />
                )}
                {(data?.availableCreditCents > 0 || (data?.credits || []).length > 0) && (
                  <section className="space-y-2">
                    <h2 className="px-1 text-[14px] font-semibold text-[#6d7075]">{`Credit with ${biz()}`}</h2>
                    <div className="rounded-2xl border border-[#ececee] bg-white p-4">
                      <p className="text-[24px] font-semibold tabular-nums text-[#1f7a4d]">{fmtMoney(data?.availableCreditCents || 0)}</p>
                      <p className="text-[13px] text-[#6d7075]">Comes off your next space booking automatically.</p>
                    </div>
                  </section>
                )}
                {groupsOf(placeRows('money', who))}
              </div>
            ) : (
              <div className="space-y-6">
                {!booksHere && (later.length > 0 || !!data?.rebookUrl) && spaceBookings}
                {groupsOf(placeRows('space', who))}
                {!hasRenter && <p className="rounded-2xl border border-[#ececee] bg-white px-4 py-4 text-[14px] leading-relaxed text-[#6d7075]">Your lease, papers and messages show here once {biz()} links your account to your renter record.</p>}
              </div>
            )}
          </div>
        )}
      </main>
      {(!loading || !!data) && (
        <nav aria-label="Portal sections" className="fixed inset-x-0 bottom-0 z-40 border-t border-[#ececee] bg-white/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto grid max-w-lg gap-1 px-2 pt-2" style={{ gridTemplateColumns: `repeat(${placesFor(who).length}, minmax(0, 1fr))` }}>
            {placesFor(who).map((k) => {
              const dot = k === 'calendar' ? (badges.book || 0) > 0 : k === 'money' ? rentDue || (badges.rent || 0) > 0 : k === 'space' ? (badges.studio || 0) > 0 : false;
              return (
                <button key={k} type="button" onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}
                  className={cn('relative flex h-12 items-center justify-center rounded-2xl text-[14px] font-medium transition-colors',
                    tab === k ? 'bg-[#16171a] text-white' : 'text-[#6d7075] hover:text-[#16171a]')}>
                  {TAB_LABEL[k]}
                  {dot && <><span aria-hidden className={cn('absolute right-2 top-2 h-2 w-2 rounded-full bg-[#b45309]', tab === k && 'ring-2 ring-[#16171a]')} /><span className="sr-only">, something waiting</span></>}
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}

function RowGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      {title && <h2 className="px-1 text-[14px] font-semibold text-[#6d7075]">{title}</h2>}
      <ul className="divide-y divide-[#ececee] overflow-hidden rounded-2xl border border-[#ececee] bg-white">
        {items.map((c, i) => <li key={i}>{c}</li>)}
      </ul>
    </section>
  );
}
function Row({ title, sub, onClick, badge, warn }: { title: string; sub?: string; onClick: () => void; badge?: number; warn?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-[44px] w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-[#fafafa]">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-[#16171a]">{title}</span>
        {sub && <span className={cn('block text-[13px] leading-snug', warn ? 'text-[#b45309]' : 'text-[#6d7075]')}>{sub}</span>}
      </span>
      {!!badge && <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full bg-[#16171a] px-2 text-[12px] font-medium text-white">{badge}</span>}
      <ChevronRight className="h-4 w-4 shrink-0 text-[#6d7075]" />
    </button>
  );
}

