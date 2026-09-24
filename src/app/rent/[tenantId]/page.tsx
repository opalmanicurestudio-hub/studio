'use client';
import { downscaleImageToDataUrl } from '@/lib/client-image';
import { getApps, initializeApp } from 'firebase/app';
import { getStorage, ref as storageRef } from 'firebase/storage';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { uploadImage } from '@/lib/upload-image';
import { firebaseConfig } from '@/firebase/config';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { credentialViews, stateLabel, CREDENTIAL_LABEL } from '@/lib/compliance';
import { LINK_KINDS, SECTION_KINDS, RENTER_FONTS, onAccent } from '@/lib/renter-identity';
import { useToast } from '@/hooks/use-toast';
import {
  Armchair, CalendarDays, Clock, CreditCard, LogOut, Loader,
  CheckCircle2, Sparkles, ChevronRight, Receipt, AlertTriangle,
  Wallet, KeyRound, Phone, RefreshCw, Repeat, X,
  MessageSquare,
  CalendarClock,
  Users,
  Home,
  Store,
  BellRing,
  ShieldAlert,
  Wrench,
  CloudLightning,
  FileSignature,
} from 'lucide-react';
import { Chip, SectionTitle, fmtDate, fmtMoney, localISO } from '@/components/rent/shared';
import { MyBook, MyClientMessages, MyClients, TellMeWhen } from '@/components/rent/business';
import { GettingSetUp, MyBooks, MyBrand, MyHours, MyMemberships, MyNumber, MyPackages, MyPage, MyCampaigns, MyPayments, MyProfile, MyReconnect, MyReviews, MyServices } from '@/components/rent/setup';
import { LoginFlow, MySwaps, RenterConcerns, RenterDocuments, RenterInterruptions, RenterLeave, RenterMaintenance, RenterThread, ResCard, STORE, TodayQuick, api } from '@/components/rent/studio';

// ─── Main page ────────────────────────────────────────────────────────────────
export default function RenterPortalPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const { toast } = useToast();

  const [session, setSession] = useState<{ token: string; expiresAt: number; name: string | null } | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const s = JSON.parse(localStorage.getItem(STORE(tenantId)) || 'null');
      return s && s.expiresAt > Date.now() ? s : null;
    } catch { return null; }
  });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [credBusy, setCredBusy] = useState<'license' | 'insurance' | null>(null);
  const [credDone, setCredDone] = useState<'license' | 'insurance' | null>(null);
  const [credOpen, setCredOpen] = useState<'license' | 'insurance' | null>(null);
  const [credForm, setCredForm] = useState({ expiry: '', carrier: '', policyNumber: '' });

  const saveSession = (s: { token: string; expiresAt: number; name: string | null } | null) => {
    if (s) localStorage.setItem(STORE(tenantId), JSON.stringify(s));
    else localStorage.removeItem(STORE(tenantId));
    setSession(s);
    if (!s) setData(null);
  };

  // Magic link (?rt=TOKEN): the owner shared a personal sign-in link from
  // the renter's profile — exchange it for a session on arrival, then wipe
  // the token from the URL so it doesn't linger in history or share sheets.
  // This is the no-SMS path: it works before Twilio is configured.
  useEffect(() => {
    if (typeof window === 'undefined' || session?.token) return;
    const rt = new URLSearchParams(window.location.search).get('rt');
    if (!rt) return;
    window.history.replaceState({}, '', window.location.pathname);
    (async () => {
      const d = await api({ action: 'token-login', tenantId, magicToken: rt });
      if (d.ok && d.token) saveSession({ token: d.token, expiresAt: d.expiresAt, name: d.name || null });
      else toast({ variant: 'destructive', title: 'Link didn’t work', description: d.error || 'Sign in with your phone or email below.' });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async (tok?: string) => {
    const token = tok || session?.token;
    if (!token) return;
    setLoading(true);
    const d = await api({ action: 'me', tenantId, token, today: localISO() });
    setLoading(false);
    if (d.ok) setData(d);
    else if (d.status === 401) saveSession(null);
    else toast({ variant: 'destructive', title: 'Couldn’t load your info', description: d.error || 'Pull to refresh or try again.' });
  }, [session?.token, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (session?.token && !data) refresh(); }, [session?.token]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (d.ok) toast({ title: 'Rent paid ✓', description: 'Your receipt is in Payment History below.' });
      else toast({ variant: 'destructive', title: 'Payment needs attention', description: d.error || 'If you were charged, contact the studio — nothing is lost.' });
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
  // ── Four destinations, not twenty-one sections ─────────────────────────
  // A renter logs in for one thing: today, their book, their rent, or the
  // studio. Every section still exists; it now lives under the tab it
  // belongs to, and the bottom bar lights up the tab that has something
  // waiting. Hidden tabs stay mounted (CSS), so switching is instant and no
  // subscription re-fires.
  const [tab, setTab] = useState<'today' | 'book' | 'rent' | 'studio'>('today');
  useEffect(() => { if (!booksHere && tab === 'book') setTab('today'); }, [booksHere, tab]);
  const [badges, setBadges] = useState<Record<string, number>>({});
  // Book → Setup: seven configuration panels folded into one list, opened one at a time.
  const [setupOpen, setSetupOpen] = useState<string>('');
  // Rent → History: the archive folded away until asked for.
  const [historyOpen, setHistoryOpen] = useState(false);
  const rentDue = (data?.invoices || []).some((i: any) => i.status === 'due' || i.status === 'late');
  const rentLate = (data?.invoices || []).some((i: any) => i.status === 'late');
  const openInvoices = useMemo(() => (data?.invoices || []).filter((i: any) => i.status === 'due' || i.status === 'late'), [data]);

  const doCheckIn = async (reservationId: string) => {
    if (!session) return;
    setActionBusy(true);
    const d = await api({ action: 'check-in', tenantId, token: session.token, reservationId, today: localISO() });
    setActionBusy(false);
    if (d.ok) {
      toast({
        title: 'You’re checked in ✓',
        description: d.needsBalance
          ? `Reminder: ${fmtMoney(d.balanceDueCents)} balance is ${d.balanceMode === 'at_checkin' ? 'due now at the front desk' : 'payable in person'}.`
          : 'Have a great day at the studio.',
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
    else if (d.ok && d.alreadyPaid) { toast({ title: 'Already paid ✓' }); refresh(); }
    else if (d.status === 401) { saveSession(null); }
    else toast({ variant: 'destructive', title: 'Couldn’t start payment', description: d.error || 'You can always pay at the front desk.' });
  };

  const requestReschedule = async (reservationId: string) => {
    if (!session) return;
    setActionBusy(true);
    const d = await api({ action: 'request-reschedule', tenantId, token: session.token, reservationId });
    setActionBusy(false);
    if (d.ok) {
      toast({ title: 'Request sent ✓', description: 'The studio will reach out to move your booking.' });
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
        ? `${fmtMoney(d.overageDueCents)} for ${d.overageMinutes} extra minutes will be settled by the studio.`
        : d.potentialCreditCents > 0
          ? `${fmtMoney(d.potentialCreditCents)} of unused time was sent to the studio for credit review.`
          : 'All settled — see you next time.';
      toast({ title: 'Checked out ✓', description: desc });
      refresh();
    } else if (d.status === 401) { saveSession(null); }
    else toast({ variant: 'destructive', title: 'Check-out didn’t go through', description: d.error || 'See the front desk.' });
  };

  if (!session) return <LoginFlow tenantId={tenantId} onSession={s => { saveSession(s); refresh(s.token); }} />;

  const firstName = (data?.name || session.name || '').split(' ')[0] || 'there';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-lg mx-auto px-4 pb-16">

        <header className="flex items-center justify-between pt-8 pb-6">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">{data?.studioName || 'Studio'}</p>
            <h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Hi, {firstName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => refresh()} disabled={loading}
              className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 active:scale-95 transition-all">
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
            <button onClick={() => saveSession(null)}
              className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-red-500 active:scale-95 transition-all">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {loading && !data ? (
          <div className="flex flex-col items-center py-24 gap-3 text-slate-400">
            <Loader className="w-8 h-8 animate-spin" />
            <p className="text-[10px] font-black uppercase tracking-widest">Loading your studio life…</p>
          </div>
        ) : (
          <div className="space-y-8 pb-24">
            {session?.token && <TodayQuick data={data} booksHere={booksHere} onGo={setTab} tenantId={tenantId} token={session.token} onBadges={setBadges} visible={tab === 'today'} />}
            <div className={tab === 'today' ? 'space-y-8' : 'hidden'}>
            {todays.length > 0 && (
              <section className="space-y-3">
                <SectionTitle icon={Clock}>Today</SectionTitle>
                {todays.map((r: any) => (
                  <ResCard key={r.id} r={r} isToday onCheckIn={doCheckIn} onCheckOut={doCheckOut} busy={actionBusy} />
                ))}
              </section>
            )}

            {session?.token && (
              <GettingSetUp data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}

            {session?.token && data?.renter?.id && !booksHere && (
              <section className="space-y-3">
                <SectionTitle icon={CalendarDays}>Bookings</SectionTitle>
                <div className="p-4 rounded-3xl bg-white border-2 border-slate-100">
                  {data?.bookingMode === 'own' ? (
                    <>
                      <p className="text-[12px] font-bold text-slate-800">You take your own bookings.</p>
                      <p className="mt-1 text-[11px] font-medium text-slate-500">
                        Your menu, calendar and clients live in your own system, so this portal keeps to rent, documents and messages.
                        If you ever want to run bookings from here instead, ask the studio to switch it on.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-[12px] font-bold text-slate-800">Bookings aren&apos;t switched on for you here yet.</p>
                      <p className="mt-1 text-[11px] font-medium text-slate-500">
                        Once the studio enables it, this portal gains your service menu, your hours, a booking link of your own,
                        your appointment book, your client list and your payouts. Ask them to turn it on — it takes them one tap.
                      </p>
                    </>
                  )}
                </div>
              </section>
            )}

            </div>
            <div className={tab === 'book' ? 'space-y-8' : 'hidden'}>
            {booksHere && session?.token && <MyBook data={data} tenantId={tenantId} token={session.token} />}
            {booksHere && session?.token && <MyClients tenantId={tenantId} token={session.token} />}

            {booksHere && (
              <section className="space-y-3">
                <SectionTitle icon={Sparkles}>Setup</SectionTitle>
                <div className="rounded-3xl bg-white border-2 border-slate-100 divide-y-2 divide-slate-100 overflow-hidden">
                  {(
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'brand' ? '' : 'brand')} aria-expanded={setupOpen === 'brand'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">My brand</span><span className="block text-[10px] font-bold text-slate-500">Colour, cover, typeface — what your link looks like</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'brand' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'brand' && session?.token && (
                        <div className="px-3 pb-4">
                          <MyBrand tenantId={tenantId} token={session.token} renterId={String(data?.renter?.id || '')} />
                        </div>
                      )}
                    </div>
                  )}
                  {(
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'page' ? '' : 'page')} aria-expanded={setupOpen === 'page'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">My page</span><span className="block text-[10px] font-bold text-slate-500">Gallery, about, questions, policies — on your booking link</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'page' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'page' && session?.token && (
                        <div className="px-3 pb-4">
                          <MyPage tenantId={tenantId} token={session.token} renterId={String(data?.renter?.id || '')} />
                        </div>
                      )}
                    </div>
                  )}
                  {(
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'reviews' ? '' : 'reviews')} aria-expanded={setupOpen === 'reviews'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Reviews</span><span className="block text-[10px] font-bold text-slate-500">What clients said — you choose what shows</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'reviews' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'reviews' && session?.token && (
                        <div className="px-3 pb-4">
                          <MyReviews tenantId={tenantId} token={session.token} />
                        </div>
                      )}
                    </div>
                  )}
                  {(
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'services' ? '' : 'services')} aria-expanded={setupOpen === 'services'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Services</span><span className="block text-[10px] font-bold text-slate-500">Your menu and prices</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'services' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'services' && (
                        <div className="px-3 pb-4">
            {booksHere && session?.token && (
              <MyServices data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}
                        </div>
                      )}
                    </div>
                  )}
                  {(
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'packages' ? '' : 'packages')} aria-expanded={setupOpen === 'packages'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Packages</span><span className="block text-[10px] font-bold text-slate-500">Prepaid bundles of your services, on your Stripe</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'packages' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'packages' && session?.token && (
                        <div className="px-3 pb-4">
                          <MyPackages data={data} tenantId={tenantId} token={session.token} />
                        </div>
                      )}
                    </div>
                  )}
                  {(
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'memberships' ? '' : 'memberships')} aria-expanded={setupOpen === 'memberships'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Memberships</span><span className="block text-[10px] font-bold text-slate-500">Monthly plans with included visits and perks</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'memberships' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'memberships' && session?.token && (
                        <div className="px-3 pb-4">
                          <MyMemberships data={data} tenantId={tenantId} token={session.token} />
                        </div>
                      )}
                    </div>
                  )}
                  {(
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'hours' ? '' : 'hours')} aria-expanded={setupOpen === 'hours'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Hours</span><span className="block text-[10px] font-bold text-slate-500">When clients can book you</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'hours' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'hours' && (
                        <div className="px-3 pb-4">
            {booksHere && session?.token && (
              <MyHours data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}
                        </div>
                      )}
                    </div>
                  )}
                  {(
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'profile' ? '' : 'profile')} aria-expanded={setupOpen === 'profile'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Profile</span><span className="block text-[10px] font-bold text-slate-500">Photo, name, bio, Instagram</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'profile' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'profile' && (
                        <div className="px-3 pb-4">
            {data?.provider && session?.token && (
              <MyProfile data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}
                        </div>
                      )}
                    </div>
                  )}
                  {(
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'number' ? '' : 'number')} aria-expanded={setupOpen === 'number'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Booking number</span><span className="block text-[10px] font-bold text-slate-500">The number on your link</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'number' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'number' && (
                        <div className="px-3 pb-4">
            {booksHere && session?.token && (
              <MyNumber data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}
                        </div>
                      )}
                    </div>
                  )}
                  {(
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'messages' ? '' : 'messages')} aria-expanded={setupOpen === 'messages'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Client messages</span><span className="block text-[10px] font-bold text-slate-500">Reminders and thank-yous, in your name</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'messages' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'messages' && (
                        <div className="px-3 pb-4">
            {booksHere && session?.token && <MyClientMessages tenantId={tenantId} token={session.token} />}
                        </div>
                      )}
                    </div>
                  )}
                  {booksHere && (
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'campaigns' ? '' : 'campaigns')} aria-expanded={setupOpen === 'campaigns'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Campaigns</span><span className="block text-[10px] font-bold text-slate-500">An email or text to your clients</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'campaigns' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'campaigns' && session?.token && (
                        <div className="px-3 pb-4">
                          <MyCampaigns data={data} tenantId={tenantId} token={session.token} />
                        </div>
                      )}
                    </div>
                  )}
                  {booksHere && (
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'reconnect' ? '' : 'reconnect')} aria-expanded={setupOpen === 'reconnect'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Reconnect</span><span className="block text-[10px] font-bold text-slate-500">Nudge clients who've gone quiet</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'reconnect' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'reconnect' && session?.token && (
                        <div className="px-3 pb-4">
                          <MyReconnect tenantId={tenantId} token={session.token} />
                        </div>
                      )}
                    </div>
                  )}
                  {booksHere && (
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'alerts' ? '' : 'alerts')} aria-expanded={setupOpen === 'alerts'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Tell me when…</span><span className="block text-[10px] font-bold text-slate-500">Bookings, requests, cancels — to your phone</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'alerts' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'alerts' && session?.token && (
                        <div className="px-3 pb-4">
                          <TellMeWhen tenantId={tenantId} token={session.token} />
                        </div>
                      )}
                    </div>
                  )}
                  {data?.swaps?.enabled !== false && (
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'swaps' ? '' : 'swaps')} aria-expanded={setupOpen === 'swaps'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Swaps</span><span className="block text-[10px] font-bold text-slate-500">Shared-space day swaps</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'swaps' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'swaps' && (
                        <div className="px-3 pb-4">
            {booksHere && session?.token && data?.swaps?.enabled !== false && (
              <MySwaps data={data} tenantId={tenantId} token={session.token} onChanged={() => refresh()} />
            )}
                        </div>
                      )}
                    </div>
                  )}
                  {(
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'books' ? '' : 'books')} aria-expanded={setupOpen === 'books'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Books</span><span className="block text-[10px] font-bold text-slate-500">Earned, rent, expenses, net — by month</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'books' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'books' && session?.token && (
                        <div className="px-3 pb-4">
                          <MyBooks tenantId={tenantId} token={session.token} />
                        </div>
                      )}
                    </div>
                  )}
                  {(
                    <div>
                      <button type="button" onClick={() => setSetupOpen(setupOpen === 'payouts' ? '' : 'payouts')} aria-expanded={setupOpen === 'payouts'}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                        <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">Payouts</span><span className="block text-[10px] font-bold text-slate-500">Where your money lands</span></span>
                        <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', setupOpen === 'payouts' && 'rotate-90')} />
                      </button>
                      {setupOpen === 'payouts' && (
                        <div className="px-3 pb-4">
            {booksHere && session?.token && (
              <MyPayments data={data} tenantId={tenantId} token={session.token} />
            )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}
            </div>
            <div className={tab === 'rent' ? 'space-y-8' : 'hidden'}>
            {data?.lease && (
              <section className="space-y-3">
                <SectionTitle icon={Wallet}>Your Rent</SectionTitle>
                <div className="p-4 rounded-3xl bg-white border-2 border-slate-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-black text-slate-900 text-sm">{data.lease.boothName || 'Your space'}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
                        {fmtMoney(data.lease.rentAmountCents)} / {String(data.lease.frequency || 'month').replace('biweekly', '2 weeks').replace('ly', '')}
                      </p>
                    </div>
                    {openInvoices.some((i: any) => i.status === 'late')
                      ? <Chip tone="red">Late</Chip>
                      : openInvoices.length > 0 ? <Chip tone="amber">Due</Chip> : <Chip tone="green">Current</Chip>}
                  </div>
                  {openInvoices.map((i: any) => (
                    <div key={i.id} className={cn('flex items-center justify-between p-3 rounded-xl',
                      i.status === 'late' ? 'bg-red-50' : 'bg-amber-50')}>
                      <div>
                        <p className={cn('text-[11px] font-black', i.status === 'late' ? 'text-red-700' : 'text-amber-700')}>
                          {fmtMoney(i.amountCents + i.lateFeeCents)}
                          {i.lateFeeCents > 0 && <span className="font-bold opacity-70"> (incl. {fmtMoney(i.lateFeeCents)} late fee)</span>}
                          {i.creditAppliedCents > 0 && <span className="block text-[10px] font-black uppercase tracking-widest text-emerald-700">{fmtMoney(i.creditAppliedCents)} credit applied{i.grossCents ? ` · was ${fmtMoney(i.grossCents)}` : ''}{i.creditNote ? ` · ${i.creditNote}` : ''}</span>}
                        </p>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Due {fmtDate(i.dueDate)}</p>
                      </div>
                      <button onClick={() => payInvoice(i.id)} disabled={actionBusy}
                        className={cn('h-9 px-4 rounded-xl font-black uppercase tracking-widest text-[10px] text-white active:scale-95 transition-all disabled:opacity-50 shrink-0',
                          i.status === 'late' ? 'bg-red-600' : 'bg-slate-900')}>
                        {actionBusy ? '…' : 'Pay Now'}
                      </button>
                    </div>
                  ))}
                  {/* Autopay — their own switch. Reads the same flag the owner
                      can set; refuses without a card on file. */}
                  {(() => {
                    const r: any = data?.renter || {};
                    const on = r.autopayEnabled === true;
                    return (
                      <button type="button" disabled={actionBusy}
                        onClick={async () => {
                          if (!on && !r.cardOnFile) { toast({ variant: 'destructive', title: 'No card on file', description: 'Add a card first — autopay needs one to draft from.' }); return; }
                          setActionBusy(true);
                          const d = await api({ action: 'autopay-set', tenantId, token: session?.token, enabled: !on });
                          setActionBusy(false);
                          if (!d.ok) { toast({ variant: 'destructive', title: 'Could not change autopay', description: d.error || 'Try again in a moment.' }); return; }
                          toast({ title: !on ? 'Autopay on' : 'Autopay off', description: !on ? 'Your rent drafts on each due day.' : 'You pay each invoice yourself from now on.' });
                          refresh();
                        }}
                        aria-pressed={on}
                        className={cn('w-full rounded-2xl border-2 px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors disabled:opacity-50',
                          on ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white')}>
                        <span className="min-w-0">
                          <span className="block text-[11px] font-black uppercase tracking-widest text-slate-900">Autopay</span>
                          <span className="block text-[10px] font-bold text-slate-500">
                            {on
                              ? `Your rent drafts on each due day from ${r.cardBrand || 'your card'} ····${r.cardLast4 || ''}. Nothing to remember.`
                              : r.cardOnFile ? `Off — you pay each invoice yourself. Your ${r.cardBrand || 'card'} ····${r.cardLast4 || ''} is saved if you'd like it automatic.`
                              : 'Off — add a card on file to turn this on.'}
                          </span>
                        </span>
                        <span className={cn('shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest',
                          on ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500')}>{on ? 'On' : 'Off'}</span>
                      </button>
                    );
                  })()}
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-300 text-center">Prefer cash or check? Pay at the front desk — it posts here too.</p>
                </div>
              </section>
            )}

            {(data?.availableCreditCents > 0 || (data?.credits || []).length > 0) && (
              <section className="space-y-3">
                <SectionTitle icon={Sparkles}>Studio Credit</SectionTitle>
                <div className="p-5 rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-xl shadow-emerald-200">
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] opacity-70">Available balance</p>
                  <p className="text-4xl font-black tracking-tighter font-mono mt-1">{fmtMoney(data?.availableCreditCents || 0)}</p>
                  <p className="text-[10px] font-bold opacity-80 mt-2">Applies automatically to your next booking.</p>
                </div>
              </section>
            )}

            {session?.token && data?.lease && (
              <RenterLeave tenantId={tenantId} token={session.token} />
            )}

            {session?.token && data?.renter?.id && (
              <RenterInterruptions tenantId={tenantId} token={session.token} />
            )}


            <section className="space-y-3">
              <button type="button" onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen}
                className="flex w-full items-center justify-between gap-3 rounded-3xl border-2 border-slate-100 bg-white px-4 py-3.5 text-left">
                <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">History</span><span className="block text-[10px] font-bold text-slate-500">Payments made, day bookings, past visits</span></span>
                <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', historyOpen && 'rotate-90')} />
              </button>
              {historyOpen && (
                <div className="space-y-8">
            {(data?.payments || []).length > 0 && (
              <section className="space-y-3">
                <SectionTitle icon={Receipt}>Payment History</SectionTitle>
                <div className="rounded-3xl bg-white border-2 border-slate-100 divide-y divide-slate-50 overflow-hidden">
                  {(data.payments || []).map((p: any) => (
                    <div key={p.id || p.date + p.description} className="flex items-center justify-between p-3.5">
                      <div className="min-w-0 pr-3">
                        <p className="text-[11px] font-bold text-slate-800 truncate">{p.description || p.category}</p>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                          {p.date ? fmtDate(String(p.date).slice(0, 10)) : ''}
                        </p>
                      </div>
                      <p className={cn('text-xs font-black font-mono shrink-0',
                        p.type === 'reversal' ? 'text-slate-400' : 'text-slate-900')}>
                        {p.type === 'reversal' ? '−' : ''}${Number(p.amount || 0).toFixed(2)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-3">
              <SectionTitle icon={CalendarDays}>Upcoming Bookings</SectionTitle>
              {later.length === 0 && todays.length === 0 ? (
                <div className="p-6 rounded-3xl bg-white border-2 border-dashed border-slate-200 text-center space-y-2">
                  <Armchair className="w-8 h-8 text-slate-200 mx-auto" />
                  <p className="text-[11px] font-bold text-slate-400">No upcoming bookings</p>
                </div>
              ) : (
                later.map((r: any) => <ResCard key={r.id} r={r} isToday={false} onRequestReschedule={requestReschedule} busy={actionBusy} />)
              )}
              {data?.rebookUrl && (
                <a href={data.rebookUrl}
                  className="w-full h-12 rounded-2xl border-2 border-violet-200 bg-violet-50 text-violet-700 font-black uppercase tracking-widest text-[11px] active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                  Book Another Visit <ChevronRight className="w-4 h-4" />
                </a>
              )}
            </section>

            {(data?.past || []).length > 0 && (
              <section className="space-y-3">
                <SectionTitle icon={CreditCard}>Past Visits</SectionTitle>
                <div className="space-y-2">
                  {(data.past || []).map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between p-3.5 rounded-2xl bg-white border border-slate-100">
                      <div className="min-w-0 pr-3">
                        <p className="text-[11px] font-bold text-slate-800 truncate">{r.boothName}</p>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{fmtDate(r.startDate)}</p>
                      </div>
                      <Chip tone={r.status === 'refunded' ? 'slate' : 'slate'}>
                        {String(r.status || '').replace(/_/g, ' ')}
                      </Chip>
                    </div>
                  ))}
                </div>
              </section>
            )}
                </div>
              )}
            </section>
            </div>
            <div className={tab === 'studio' ? 'space-y-8' : 'hidden'}>
            {session?.token && data?.renter?.id && (
              <RenterThread tenantId={tenantId} token={session.token} studioName={data?.studioName || data?.tenant?.name || 'the studio'} />
            )}

            {session?.token && data?.renter?.id && (
              <RenterMaintenance tenantId={tenantId} token={session.token} />
            )}

            {session?.token && data?.renter?.id && (
              <RenterConcerns tenantId={tenantId} token={session.token} />
            )}

            {session?.token && data?.renter?.id && (
              <RenterDocuments tenantId={tenantId} token={session.token} />
            )}

            <section className="space-y-3">
              <SectionTitle icon={Receipt}>Insurance &amp; licence</SectionTitle>
              <div className="rounded-3xl bg-white border-2 border-slate-100 p-4 space-y-2.5">
                {credentialViews(data?.renter, { bookingPageSettings: { automationRules: data?.compliance || {} } }, new Date().toISOString().slice(0, 10)).map((v) => {
                  const kind = v.kind;
                  const tone = v.state === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : v.state === 'expiring' ? 'border-amber-200 bg-amber-50 text-amber-900' : (v.state === 'expired' || (v.state === 'missing' && v.required)) ? 'border-red-200 bg-red-50 text-red-900' : 'border-slate-200 bg-slate-50 text-slate-700';
                  return (
                    <div key={kind} className={cn('rounded-2xl border-2 px-3.5 py-3 space-y-2', tone)}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-black uppercase tracking-widest">{CREDENTIAL_LABEL[kind]}</p>
                        <span className="text-[10px] font-black">{stateLabel(v)}</span>
                      </div>
                      {kind === 'insurance' && (v.carrier || v.policyNumber) && <p className="text-[11px] font-bold">{v.carrier}{v.carrier && v.policyNumber ? ' · ' : ''}{v.policyNumber ? `policy ${v.policyNumber}` : ''}</p>}
                      {v.state === 'missing' && v.required && <p className="text-[10px] font-bold">The studio requires this on file to rent here.</p>}
                      {v.docUrl && <a href={v.docUrl} target="_blank" rel="noopener" className="text-[10px] font-black uppercase tracking-widest underline">See the copy on file</a>}
                      {credOpen === kind ? (
                        <div className="space-y-2 pt-1">
                          <input type="date" value={credForm.expiry} onChange={(e) => setCredForm((f) => ({ ...f, expiry: e.target.value }))} aria-label="Expiry date on the document" className="h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
                          {kind === 'insurance' && (
                            <div className="grid grid-cols-2 gap-2">
                              <input value={credForm.carrier} onChange={(e) => setCredForm((f) => ({ ...f, carrier: e.target.value.slice(0, 120) }))} aria-label="Insurance carrier" placeholder="Carrier" className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
                              <input value={credForm.policyNumber} onChange={(e) => setCredForm((f) => ({ ...f, policyNumber: e.target.value.slice(0, 80) }))} aria-label="Policy number" placeholder="Policy number" className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
                            </div>
                          )}
                          <p className="text-[9px] font-bold opacity-80">Enter the expiry date exactly as it appears on the document, then attach a photo of it. The studio is notified automatically.</p>
                          <div className="flex gap-2">
                            <label className={cn('h-11 flex-1 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest flex items-center justify-center cursor-pointer', (credBusy === kind || !credForm.expiry) && 'opacity-50 pointer-events-none')}>
                              {credBusy === kind ? 'Uploading…' : 'Attach photo & save'}
                              <input type="file" accept="image/*" capture="environment" className="hidden" disabled={!!credBusy || !credForm.expiry}
                                onChange={async (e) => {
                                  const f = e.target.files?.[0]; e.target.value = '';
                                  if (!f || !session) return;
                                  setCredBusy(kind);
                                  try {
                                    const dataUrl: string = await downscaleImageToDataUrl(f, { maxDim: 1600 });
                                    const d = await api({ action: 'upload-credential', tenantId, token: session.token, kind, photoData: dataUrl, expiry: credForm.expiry, carrier: credForm.carrier, policyNumber: credForm.policyNumber });
                                    if (d.ok) { setCredDone(kind); setCredOpen(null); setCredForm({ expiry: '', carrier: '', policyNumber: '' }); toast({ title: 'On file ✓', description: 'The studio has been notified.' }); void refresh(); }
                                    else toast({ variant: 'destructive', title: 'Upload failed', description: d.error || 'Try again.' });
                                  } catch { toast({ variant: 'destructive', title: 'Upload failed', description: 'Try again.' }); }
                                  finally { setCredBusy(null); }
                                }} />
                            </label>
                            <button type="button" onClick={() => setCredOpen(null)} className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-600">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" onClick={() => { setCredOpen(kind); setCredForm({ expiry: v.expiry || '', carrier: v.carrier || '', policyNumber: v.policyNumber || '' }); }}
                          className="h-10 w-full rounded-2xl border-2 border-current/20 bg-white text-[10px] font-black uppercase tracking-widest text-slate-700">
                          {credDone === kind ? 'Uploaded ✓ · update again' : v.docUrl ? 'Upload a renewed one' : `Add ${kind === 'insurance' ? 'insurance' : 'licence'}`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            </div>
          </div>
        )}
      </div>
      {session && !loading && (
        <nav aria-label="Portal sections"
          className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-slate-200 bg-white/95 backdrop-blur pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto grid max-w-md gap-1 px-2 pt-2" style={{ gridTemplateColumns: `repeat(${booksHere ? 4 : 3}, minmax(0, 1fr))` }}>
            {([
              ['today', 'Today', Home, false],
              ...(booksHere ? [['book', 'Book', CalendarDays, (badges.book || 0) > 0]] : []),
              ['rent', 'Rent', Wallet, rentDue || (badges.rent || 0) > 0],
              ['studio', 'Studio', Store, (badges.studio || 0) > 0],
            ] as [typeof tab, string, any, boolean][]).map(([k, label, Icon, dot]) => (
              <button key={k} type="button" onClick={() => { setTab(k); window.scrollTo({ top: 0 }); }} aria-pressed={tab === k} aria-label={label}
                className={cn('relative flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[9px] font-black uppercase tracking-widest', tab === k ? 'bg-slate-900 text-white' : 'text-slate-500')}>
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
                {dot && <span className={cn('absolute right-3 top-1.5 h-2 w-2 rounded-full', rentLate ? 'bg-red-500' : 'bg-amber-400', tab === k && 'ring-2 ring-slate-900')} />}
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
