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
import { SectionTitle, fmtDate } from '@/components/rent/shared';
import { api, hrs, storageDiagnostic, uploadRenterPhoto } from '@/components/rent/studio';

// ─── My Hours: the renter's own weekly availability ──────────────────────────
// Writes staff.availability.week, which the booking engine already treats as
// layer 3 (per-staff weekly hours) — so a renter's template beats the house
// profile for their own link, with no engine changes. Days left off simply
// produce no slots.
export const DAY_ROWS: Array<[string, string]> = [
  ['monday', 'Mon'], ['tuesday', 'Tue'], ['wednesday', 'Wed'], ['thursday', 'Thu'],
  ['friday', 'Fri'], ['saturday', 'Sat'], ['sunday', 'Sun'],
];

export function MyHours({ data, tenantId, token, onChanged }: { data: any; tenantId: string; token: string; onChanged: () => void }) {
  const initial = () => {
    const w = data?.provider?.week || {};
    const out: any = {};
    for (const [key] of DAY_ROWS) {
      const r = w[key] || {};
      out[key] = { enabled: !!r.enabled, start: r.start || '09:00', end: r.end || '17:00' };
    }
    return out;
  };
  const [week, setWeek] = useState<any>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const set = (day: string, patch: any) => setWeek((w: any) => ({ ...w, [day]: { ...w[day], ...patch } }));

  const save = async () => {
    setBusy(true); setErr('');
    const bad = DAY_ROWS.find(([k]) => week[k].enabled && !(week[k].start < week[k].end));
    if (bad) { setBusy(false); setErr('End time has to be after start time.'); return; }
    const d = await api({ action: 'my-hours', tenantId, token, week });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'Could not save'); return; }
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    onChanged();
  };

  const anyOn = DAY_ROWS.some(([k]) => week[k].enabled);

  return (
    <section className="space-y-3">
      <SectionTitle icon={Clock}>My Hours</SectionTitle>
      <div className="p-4 rounded-3xl bg-white border-2 space-y-2">
        <p className="text-[11px] font-bold text-slate-500">
          When clients can book you. These are your hours — they don&apos;t have to match the studio&apos;s.
        </p>
        {Array.isArray(data?.provider?.leasedDays) && data.provider.leasedDays.length > 0 && (
          <p className="rounded-2xl bg-slate-50 p-3 text-[11px] font-bold text-slate-600">
            Your lease covers {data.provider.leasedDays.map((d: string) => d.slice(0, 3)).join(', ')}
            {data.provider.leasedStart ? ' ' + data.provider.leasedStart + '\u2013' + (data.provider.leasedEnd || 'close') : ''}.
            {' '}Hours outside that save as off — the chair belongs to someone else then.
          </p>
        )}
        {DAY_ROWS.map(([key, label]) => (
          <div key={key} className="flex items-center gap-2 rounded-2xl border-2 p-2">
            <button type="button" onClick={() => set(key, { enabled: !week[key].enabled })}
                    className={cn('h-9 w-16 shrink-0 rounded-xl text-[10px] font-black uppercase tracking-widest',
                      week[key].enabled ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400')}>
              {label}
            </button>
            {week[key].enabled ? (
              <div className="flex flex-1 items-center gap-2">
                <input type="time" value={week[key].start} onChange={e => set(key, { start: e.target.value })}
                       className="h-9 min-w-0 flex-1 rounded-xl border-2 px-2 text-[12px] font-bold" />
                <span className="text-[11px] font-black text-slate-400">to</span>
                <input type="time" value={week[key].end} onChange={e => set(key, { end: e.target.value })}
                       className="h-9 min-w-0 flex-1 rounded-xl border-2 px-2 text-[12px] font-bold" />
              </div>
            ) : (
              <span className="flex-1 text-[11px] font-bold text-slate-400">Off</span>
            )}
          </div>
        ))}
        {!anyOn && (
          <p className="rounded-2xl bg-amber-50 p-3 text-[11px] font-bold text-amber-800">
            Every day is off right now, so nobody can book you. Turn on at least one day.
          </p>
        )}
        {err && <p className="text-[11px] font-black text-red-600">{err}</p>}
        <button onClick={save} disabled={busy}
                className="h-11 w-full rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white active:scale-95 disabled:opacity-50">
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save my hours'}
        </button>
        <p className="text-[10px] font-bold text-slate-400">
          Time off for a single day? Ask the studio to block it — that keeps the calendar honest for everyone.
        </p>
      </div>
    </section>
  );
}

// ─── Card payments: their own Stripe ─────────────────────────────────────────
// Connecting here creates an account that belongs to the RENTER. Money, refunds
// and disputes are all theirs; the studio is never in the path. Half-finished
// onboarding is an expected state, not an error — services simply stay
// pay-in-person until Stripe reports charges are live.
export function MyPayments({ data, tenantId, token }: { data: any; tenantId: string; token: string }) {
  const [st, setSt] = useState<any>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/portal/renter-connect', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', tenantId, token }),
        });
        const d = await res.json().catch(() => ({}));
        if (!cancelled) setSt(d);
      } catch { /* offline — the card just shows the connect option */ }
      if (!cancelled) setBusy(false);
    })();
    return () => { cancelled = true; };
  }, [tenantId, token]);

  const connected = !!st?.connected;
  const live = !!st?.chargesEnabled;
  const submitted = !!st?.detailsSubmitted;
  const onboardHref = `/api/portal/renter-connect?tenantId=${encodeURIComponent(tenantId)}&token=${encodeURIComponent(token)}`;

  return (
    <section className="space-y-3">
      <SectionTitle icon={CreditCard}>Card Payments</SectionTitle>
      <div className="p-4 rounded-3xl bg-white border-2 space-y-3">
        {busy ? (
          <p className="py-3 text-center text-[11px] font-bold text-slate-400">Checking your account…</p>
        ) : live ? (
          <div className="rounded-2xl bg-emerald-50 p-4">
            <p className="text-[13px] font-black text-emerald-900">You can take cards.</p>
            <p className="mt-1 text-[11px] font-bold text-emerald-800">
              Payments go straight to your own Stripe account and pay out to your bank. {data?.studioName || 'The studio'} never touches them.
            </p>
          </div>
        ) : connected && submitted ? (
          <div className="rounded-2xl bg-amber-50 p-4">
            <p className="text-[13px] font-black text-amber-900">Stripe is still reviewing your details.</p>
            <p className="mt-1 text-[11px] font-bold text-amber-800">
              This usually takes a few minutes. Until it clears, your clients pay you in person as usual — nothing is broken.
            </p>
          </div>
        ) : connected ? (
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-[13px] font-black text-slate-900">You started setting up — a few steps left.</p>
            <p className="mt-1 text-[11px] font-bold text-slate-500">Pick up where you left off. Your bookings keep working meanwhile.</p>
          </div>
        ) : (
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-[13px] font-black text-slate-900">Want to take cards and deposits?</p>
            <p className="mt-1 text-[11px] font-bold text-slate-500">
              Connect your own Stripe account — you keep 100%, minus Stripe&apos;s normal processing fee. It pays out to your bank, not the studio&apos;s.
            </p>
          </div>
        )}

        {!live && !busy && (
          <a href={onboardHref}
             className="flex h-11 w-full items-center justify-center rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white active:scale-95">
            {connected ? 'Finish setting up' : 'Connect my Stripe'}
          </a>
        )}
        {live && (
          <a href={onboardHref}
             className="flex h-11 w-full items-center justify-center rounded-2xl border-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
            Manage my account
          </a>
        )}
        <p className="text-[10px] font-bold text-slate-400">
          Payment questions go to Stripe, not the front desk — it&apos;s your account.
        </p>
      </div>
    </section>
  );
}

// ─── My Number: what they need to earn ───────────────────────────────────────
// Rough is fine. These inputs live in a server-only subcollection the studio
// cannot read — the card says so plainly, because a renter's landlord asking
// about their household budget is exactly the thing that would stop them from
// answering honestly. Sharing is one derived rate, opt-in, off by default.
export function MyNumber({ data, tenantId, token, onChanged }: { data: any; tenantId: string; token: string; onChanged: () => void }) {
  const p = data?.pricing || {};
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [personal, setPersonal] = useState(String(((Number(p.personalMonthlyCents) || 0) / 100) || ''));
  const [business, setBusiness] = useState(String(((Number(p.businessMonthlyCents) || 0) / 100) || ''));
  const [taxPct, setTaxPct] = useState(String(p.taxSetAsidePct ?? 25));
  const [share, setShare] = useState(!!p.shareTargetHourly);

  const save = async () => {
    setBusy(true); setErr('');
    const d = await api({
      action: 'my-goals', tenantId, token,
      personalMonthly: Number(personal) || 0,
      businessMonthly: Number(business) || 0,
      taxSetAsidePct: Number(taxPct) || 0,
      shareTargetHourly: share,
    });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'Could not save'); return; }
    setOpen(false); onChanged();
  };

  const target = (Number(p.targetHourlyCents) || 0) / 100;
  const monthly = (Number(p.monthlyTargetCents) || 0) / 100;

  return (
    <section className="space-y-3">
      <SectionTitle icon={Wallet}>My Number</SectionTitle>
      <div className="p-4 rounded-3xl bg-white border-2 space-y-3">
        {p.hasGoals && !open ? (
          <div className="rounded-2xl bg-slate-900 p-4 text-white">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/50">Your hour needs to make</p>
            <p className="text-3xl font-black">${target.toFixed(2)}</p>
            <p className="mt-1 text-[11px] font-bold text-white/70">
              ${monthly.toFixed(2)} a month across {p.bookableHoursPerMonth} booked hours — rent, taxes and living covered.
            </p>
          </div>
        ) : !open ? (
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-[13px] font-black text-slate-900">Know what your hour has to earn.</p>
            <p className="mt-1 text-[11px] font-bold text-slate-500">
              Tell us roughly what you need each month and we&apos;ll work backwards through taxes and rent to the number that makes your prices make sense.
            </p>
          </div>
        ) : null}

        {open && (
          <div className="space-y-2">
            <p className="rounded-2xl bg-emerald-50 p-3 text-[11px] font-bold text-emerald-900">
              🔒 Only you can see these numbers. {data?.studioName || 'The studio'} sees that you&apos;ve set a goal, never what&apos;s in it.
            </p>
            <label className="block">
              <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">What you need to live on, a month</span>
              <input type="number" min={0} value={personal} onChange={e => setPersonal(e.target.value)} placeholder="3000"
                     className="h-11 w-full rounded-xl border-2 px-3 text-[15px] font-black" />
              <span className="mt-1 block text-[10px] font-bold text-slate-400">Housing, car, food, insurance, debt, savings — rough is fine.</span>
            </label>
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Business costs / mo</span>
                <input type="number" min={0} value={business} onChange={e => setBusiness(e.target.value)} placeholder="200"
                       className="h-11 w-full rounded-xl border-2 text-center text-[15px] font-black" />
              </label>
              <label className="flex-1">
                <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Tax set-aside %</span>
                <input type="number" min={0} max={60} value={taxPct} onChange={e => setTaxPct(e.target.value)}
                       className="h-11 w-full rounded-xl border-2 text-center text-[15px] font-black" />
              </label>
            </div>
            <button type="button" onClick={() => setShare(v => !v)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border-2 p-3 text-left">
              <span>
                <span className="block text-[12px] font-black text-slate-900">Share just my hourly target with {data?.studioName || 'the studio'}</span>
                <span className="block text-[10px] font-bold text-slate-500">One number, so they can help you price. Never your costs.</span>
              </span>
              <span className={cn('shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest',
                share ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{share ? 'On' : 'Off'}</span>
            </button>
            {err && <p className="text-[11px] font-black text-red-600">{err}</p>}
            <div className="flex gap-2">
              <button onClick={save} disabled={busy}
                      className="h-11 flex-1 rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white active:scale-95 disabled:opacity-50">
                {busy ? 'Saving…' : 'Save my number'}
              </button>
              <button onClick={() => { setOpen(false); setErr(''); }} className="h-11 rounded-2xl border-2 px-4 text-[10px] font-black uppercase tracking-widest">Cancel</button>
            </div>
          </div>
        )}

        {!open && (
          <button onClick={() => setOpen(true)}
                  className="h-11 w-full rounded-2xl border-2 border-dashed text-[10px] font-black uppercase tracking-widest text-slate-500">
            {p.hasGoals ? 'Update my number' : 'Set up my number'}
          </button>
        )}
      </div>
    </section>
  );
}



// ─── My Profile ──────────────────────────────────────────────────────────────
// What a client sees when they land on this person. Which fields matter depends
// entirely on how they take bookings, so the card asks for different things:
// someone booking through the studio needs a face and a line about themselves,
// while someone on their own system needs their real booking URL, so a client
// who lands here can still reach them instead of hitting a dead end.
export function MyProfile({ data, tenantId, token, onChanged }: { data: any; tenantId: string; token: string; onChanged: () => void }) {
  const { toast } = useToast();
  const p0 = data?.profile || {};
  const ownSystem = data?.bookingMode === 'own';
  const [biz, setBiz] = useState(data?.renter?.businessName || '');
  const [bio, setBio] = useState(p0.bio || '');
  const [ig, setIg] = useState(p0.instagram || '');
  const [links, setLinks] = useState<{ kind: string; value: string; label?: string }[]>(Array.isArray(p0.links) ? p0.links : []);
  const [url, setUrl] = useState(p0.externalBookingUrl || '');
  const [listed, setListed] = useState(p0.listExternally === true);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const shown = photo || p0.photoUrl || '';

  const pick = (e: any) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setErr('Keep the photo under 3 MB.'); return; }
    const r = new FileReader();
    r.onload = () => { setPhoto(String(r.result || '')); setErr(''); };
    r.readAsDataURL(file);
    setPhotoFile(file);
  };

  const save = async () => {
    setBusy(true); setErr('');
    let photoUrl: string | undefined;
    if (photoFile) {
      try { photoUrl = await uploadRenterPhoto(tenantId, token, String(data?.renter?.id || ''), 'profile', photoFile, 1200); }
      catch (ex: any) { setBusy(false); setErr(ex?.message || 'Could not upload that photo.'); return; }
    }
    const d = await api({
      action: 'my-profile', tenantId, token,
      businessName: biz, bio, instagram: ig, links, externalBookingUrl: url, listExternally: listed,
      ...(photoUrl ? { photoUrl } : {}),
    });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'Could not save that.'); return; }
    setPhoto(null); setPhotoFile(null);
    toast({ title: 'Profile saved', description: ownSystem ? 'Your booking link is live.' : 'Clients will see this on your booking page.' });
    onChanged();
  };

  return (
    <section className="space-y-3">
      <SectionTitle icon={Sparkles}>My Profile</SectionTitle>
      <div className="p-5 rounded-3xl bg-white border-2 space-y-4">
        {!ownSystem && (
          <>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                {shown
                  ? <img src={shown} alt="Your profile" className="w-full h-full object-cover" />
                  : <Sparkles className="w-5 h-5 text-slate-300" />}
              </div>
              <div className="min-w-0">
                <label htmlFor="pf-photo" className="block text-[11px] font-black uppercase tracking-widest text-slate-900 cursor-pointer underline">
                  {shown ? 'Change photo' : 'Add a photo'}
                </label>
                <input id="pf-photo" type="file" accept="image/*" onChange={pick} className="hidden" />
                <p className="text-[10px] font-bold text-slate-400 mt-1">A real face books better than a blank square.</p>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="pf-bio" className="block text-[10px] font-black uppercase tracking-widest text-slate-400">About you</label>
              <label htmlFor="pf-biz" className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Business name</label>
              <input id="pf-biz" value={biz} onChange={(e) => setBiz(e.target.value.slice(0, 80))} maxLength={80}
                placeholder={`${data?.renter?.firstName || ''} ${data?.renter?.lastName || ''}`.trim() || 'Your name'}
                className="mb-1 h-11 w-full rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold" />
              <p className="mb-3 text-[10px] font-bold text-slate-400">
                What clients see when they book you. Leave it empty and they see your own name.
              </p>
              <label htmlFor="pf-bio" className="block text-[10px] font-black uppercase tracking-widest text-slate-400">About you</label>
              <textarea id="pf-bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} rows={3}
                placeholder="What you specialise in, how long you've been doing it…"
                className="w-full px-3 py-3 rounded-xl border-2 border-slate-200 text-sm font-bold resize-none" />
              <p className="text-[10px] font-bold text-slate-400">{300 - bio.length} left</p>
            </div>

            <div className="space-y-1">
              <label htmlFor="pf-ig" className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Instagram</label>
              <input id="pf-ig" value={ig} onChange={(e) => setIg(e.target.value)} placeholder="yourhandle"
                className="w-full px-3 py-3 rounded-xl border-2 border-slate-200 text-sm font-bold" />
            </div>
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Your links</p>
              <p className="text-[10px] font-bold text-slate-500">These show as buttons on your booking page, under your photo — TikTok, Facebook, your website, anything. Up to eight.</p>
              {links.map((l, i) => {
                const def = LINK_KINDS.find((k) => k.kind === l.kind) || LINK_KINDS[LINK_KINDS.length - 1];
                return (
                  <div key={i} className="flex gap-2">
                    <select value={l.kind} onChange={(e) => setLinks((ls) => ls.map((x, j) => j === i ? { ...x, kind: e.target.value } : x))} aria-label="Link type"
                      className="h-11 w-28 shrink-0 rounded-xl border-2 border-slate-200 bg-white px-2 text-[11px] font-bold">
                      {LINK_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                    </select>
                    <input value={l.value} onChange={(e) => setLinks((ls) => ls.map((x, j) => j === i ? { ...x, value: e.target.value.slice(0, 200) } : x))}
                      placeholder={def.placeholder} aria-label={`${def.label} handle or URL`} inputMode="url"
                      className="h-11 flex-1 min-w-0 rounded-xl border-2 border-slate-200 px-3 text-sm font-bold" />
                    <button type="button" onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove link"
                      className="h-11 w-11 shrink-0 rounded-xl border-2 border-slate-200 text-slate-500 font-black">×</button>
                  </div>
                );
              })}
              {links.length < 8 && (
                <button type="button" onClick={() => setLinks((ls) => [...ls, { kind: ls.some((x) => x.kind === 'tiktok') ? 'website' : 'tiktok', value: '' }])}
                  className="h-10 w-full rounded-xl border-2 border-dashed border-slate-300 text-[10px] font-black uppercase tracking-widest text-slate-600">+ Add a link</button>
              )}
            </div>
          </>
        )}

        {ownSystem && (
          <>
            <div className="space-y-1">
              <label htmlFor="pf-url" className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Your booking link</label>
              <input id="pf-url" value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="https://yourname.glossgenius.com"
                className="w-full px-3 py-3 rounded-xl border-2 border-slate-200 text-sm font-bold" />
              <p className="text-[10px] font-bold text-slate-400">
                Square, GlossGenius, Booksy, your own site — wherever clients actually book you.
              </p>
            </div>

            <button onClick={() => setListed(!listed)}
              className="w-full flex items-center justify-between gap-3 p-3 rounded-2xl border-2 text-left">
              <span className="min-w-0">
                <span className="block text-[12px] font-black text-slate-900">Show me on the studio&apos;s booking page</span>
                <span className="block text-[11px] font-bold text-slate-500">
                  Clients looking for you there get sent to your link instead of finding nothing.
                </span>
              </span>
              <span className={cn('shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest',
                listed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                {listed ? 'On' : 'Off'}
              </span>
            </button>
          </>
        )}

        {err && (
          <div className="flex items-start gap-2 text-red-600">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="text-[11px] font-bold">{err}</p>
          </div>
        )}

        <button onClick={save} disabled={busy}
          className="w-full py-3 rounded-2xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50">
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </section>
  );
}

// ─── Getting set up ──────────────────────────────────────────────────────────
// Two things live here, and the first decides whether the second exists.
//
// BOOKING MODE is an explicit choice, not an absence. Plenty of renters already
// run their own booking system and are never going to move; treating that as
// "incomplete setup" would leave them staring at a permanent to-do list for
// tools they don't want. Choosing "my own system" makes their portal complete
// as it stands — rent, documents, credits — and switches every booking section
// off, including on the booking page itself, not just here.
//
// THE CHECKLIST only appears for people who chose the studio system, is derived
// live from what actually exists rather than a stored flag, and can be
// dismissed once and for good. Setup prompts that come back are nags.
export function GettingSetUp({ data, tenantId, token, onChanged }: { data: any; tenantId: string; token: string; onChanged: () => void }) {
  const { toast } = useToast();
  const cl = data?.checklist;
  const [busy, setBusy] = useState('');
  const [switching, setSwitching] = useState(false);
  const [err, setErr] = useState('');

  if (!cl) return null;

  const setMode = async (mode: 'studio' | 'own') => {
    setBusy(mode); setErr('');
    const d = await api({ action: 'booking-mode', tenantId, token, mode });
    setBusy(''); setSwitching(false);
    if (!d.ok) { setErr(d.error || 'Could not save that.'); return; }
    toast({
      title: mode === 'own' ? 'Set to your own system' : 'Set to the studio system',
      description: mode === 'own'
        ? 'Your booking sections are switched off. Your rent, documents and credits are unaffected.'
        : 'Set your hours and add a service and clients can start booking you.',
    });
    onChanged();
  };

  const dismiss = async () => {
    setBusy('dismiss');
    await api({ action: 'checklist-dismiss', tenantId, token });
    setBusy('');
    onChanged();
  };

  if (!cl.modeChosen || switching) {
    return (
      <section className="space-y-3">
        <SectionTitle icon={Sparkles}>Getting set up</SectionTitle>
        <div className="p-5 rounded-3xl bg-white border-2 space-y-3">
          <div>
            <p className="font-black text-slate-900 text-sm">How do you take bookings?</p>
            <p className="text-[11px] font-bold text-slate-500 mt-1">
              Either answer is fine, and you can change it whenever you like. Your rent, documents and credits work the same either way.
            </p>
          </div>
          <button onClick={() => setMode('studio')} disabled={!!busy}
            className="w-full p-4 rounded-2xl border-2 text-left active:scale-[0.99] transition-all disabled:opacity-50">
            <p className="text-[12px] font-black text-slate-900">I&apos;ll book through the studio</p>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
              You get your own menu at your own prices, your own hours, a personal booking link, and you keep what you charge.
            </p>
          </button>
          <button onClick={() => setMode('own')} disabled={!!busy}
            className="w-full p-4 rounded-2xl border-2 text-left active:scale-[0.99] transition-all disabled:opacity-50">
            <p className="text-[12px] font-black text-slate-900">I use my own booking system</p>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
              Square, GlossGenius, Booksy, a paper book — whatever you already use. Nothing here will pester you about it.
            </p>
          </button>
          {switching && (
            <button onClick={() => setSwitching(false)}
              className="text-[11px] font-black uppercase tracking-widest text-slate-400">Never mind</button>
          )}
          {err && (
            <div className="flex items-start gap-2 text-red-600">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <p className="text-[11px] font-bold">{err}</p>
            </div>
          )}
        </div>
      </section>
    );
  }

  if (cl.mode === 'own') {
    return (
      <section className="space-y-3">
        <div className="p-4 rounded-3xl bg-white border-2 border-slate-100">
          <p className="text-[11px] font-bold text-slate-500">
            You&apos;re running your own booking system. If you ever want to try the studio&apos;s — your own menu, your own prices, your own link —{' '}
            <button onClick={() => setSwitching(true)} className="font-black text-slate-900 underline">switch it on here</button>.
          </p>
        </div>
      </section>
    );
  }

  if (cl.dismissed || cl.allDone) {
    return (
      <section className="space-y-3">
        <div className="p-4 rounded-3xl bg-white border-2 border-slate-100">
          <p className="text-[11px] font-bold text-slate-500">
            Booking through the studio.{' '}
            <button onClick={() => setSwitching(true)} className="font-black text-slate-900 underline">Use my own system instead</button>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <SectionTitle icon={Sparkles}>Getting set up</SectionTitle>
      <div className="p-5 rounded-3xl bg-white border-2 space-y-3">
        <div>
          <p className="font-black text-slate-900 text-sm">
            {cl.remaining === 1 ? 'One thing left' : `${cl.remaining} things left`}
          </p>
          <p className="text-[11px] font-bold text-slate-500 mt-0.5">
            Until these are done, clients can&apos;t book you.
          </p>
        </div>
        <div className="space-y-2">
          {cl.items.map((it: any) => (
            <div key={it.key} className={cn('flex items-start gap-3 p-3 rounded-2xl border-2',
              it.done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200')}>
              {it.done
                ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                : <div className="w-4 h-4 rounded-full border-2 border-slate-300 mt-0.5 shrink-0" />}
              <div className="min-w-0">
                <p className={cn('text-[12px] font-black', it.done ? 'text-emerald-900' : 'text-slate-900')}>
                  {it.label}{it.optional ? ' · optional' : ''}
                </p>
                {it.hint && <p className="text-[11px] font-bold text-slate-500 mt-0.5">{it.hint}</p>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <button onClick={() => setSwitching(true)} className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            I use my own system
          </button>
          <button onClick={dismiss} disabled={!!busy} className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {busy === 'dismiss' ? '…' : 'Hide this'}
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── My Brand: colour, tone, cover, type — theirs ────────────────────────────
export function MyBrand({ tenantId, token, renterId }: { tenantId: string; token: string; renterId: string }) {
  const [brand, setBrand] = useState<any | null>(null);
  const [coverData, setCoverData] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api({ action: 'brand-get', tenantId, token }).then((d) => { if (d?.ok) setBrand(d.brand); }); }, [tenantId, token]);
  // The five faces, for the preview only — the app itself stays on Jakarta.
  useEffect(() => {
    if (document.getElementById('renter-brand-fonts')) return;
    const l = document.createElement('link'); l.id = 'renter-brand-fonts'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500&family=Lora:wght@400;500&family=Abril+Fatface&family=Raleway:wght@200;300;400&family=Outfit:wght@300;400;500&display=swap';
    document.head.appendChild(l);
  }, []);
  if (!brand) return <p className="py-2 text-center text-[11px] font-bold text-slate-400">Loading…</p>;
  const save = async () => {
    setBusy(true); setErr('');
    const d = await api({ action: 'brand-save', tenantId, token, brand, ...(coverData !== undefined ? { coverData } : {}) });
    setBusy(false);
    if (!d?.ok) { setErr(d?.error || 'Could not save.'); return; }
    setBrand(d.brand); setCoverData(undefined); setSaved(true); setTimeout(() => setSaved(false), 1800);
  };
  const cover = coverData === null ? null : (coverData || brand.coverUrl);
  const dark = brand.tone === 'dark';
  const SWATCHES = ['#1c1917', '#7c2d12', '#9f1239', '#6d28d9', '#1e3a8a', '#065f46', '#b45309', '#a16207', '#0f766e', '#831843'];
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold text-slate-500">Your page is your brand, not the studio&apos;s. Pick a colour, light or dark, a cover, a typeface. Clients see it the moment they open your link.</p>
      <div className="relative overflow-hidden rounded-2xl border-2" style={{ background: dark ? '#0c0a09' : '#faf9f7', aspectRatio: '4 / 3' }}>
        {cover && <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />}
        <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 40%, ${dark ? '#0c0a09' : '#faf9f7'} 100%)` }} />
        <div className="absolute inset-x-0 bottom-0 p-4">
          <p className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: brand.accent }}>Preview</p>
          <p className="text-2xl font-light" style={{ color: dark ? '#fafaf9' : '#1c1917', fontFamily: RENTER_FONT_STACK[brand.font] }}>Your name</p>
          {brand.tagline && <p className="text-[11px]" style={{ color: dark ? '#a8a29e' : '#57534e' }}>{brand.tagline}</p>}
          <span className="mt-2 inline-block rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest" style={{ background: brand.accent, color: onAccent(brand.accent) }}>Book</span>
        </div>
      </div>
      <div className="flex gap-2">
        <label className="h-10 flex-1 inline-flex items-center justify-center rounded-xl border-2 border-dashed text-[10px] font-black uppercase tracking-widest text-slate-600 cursor-pointer">
          {cover ? 'Change cover' : 'Add a cover image'}
          <input type="file" accept="image/*" className="sr-only" aria-label="Cover image" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setErr(''); setBusy(true); try { const url = await uploadRenterPhoto(tenantId, token, renterId, 'cover', f, 1600); const d = await api({ action: 'brand-save', tenantId, token, brand, coverUrl: url }); if (d?.ok) { setBrand(d.brand); setCoverData(undefined); setSaved(true); setTimeout(() => setSaved(false), 1800); } else setErr(d?.error || 'Uploaded, but could not save — press Save my brand.'); } catch (ex: any) { setErr(ex?.message || 'Could not upload that image.'); } finally { setBusy(false); } }} />
        </label>
        {cover && <button type="button" onClick={() => setCoverData(null)} className="h-10 rounded-xl border-2 px-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Remove</button>}
      </div>
      <div>
        <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Accent colour</p>
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map((c) => (
            <button key={c} type="button" aria-label={`Use ${c}`} aria-pressed={brand.accent === c} onClick={() => setBrand({ ...brand, accent: c })}
              className={cn('h-9 w-9 rounded-full border-2', brand.accent === c ? 'border-slate-900 ring-2 ring-slate-900 ring-offset-2' : 'border-white')} style={{ background: c }} />
          ))}
          <input type="color" value={brand.accent} onChange={(e) => setBrand({ ...brand, accent: e.target.value })} aria-label="Custom accent colour" className="h-9 w-12 rounded-lg border-2 bg-white p-0.5" />
        </div>
      </div>
      <div className="flex gap-2">
        {(['light', 'dark'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={brand.tone === t} onClick={() => setBrand({ ...brand, tone: t })}
            className={cn('h-10 flex-1 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest', brand.tone === t ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600')}>{t}</button>
        ))}
      </div>
      <div>
        <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Typeface</p>
        <div className="grid grid-cols-2 gap-1.5">
          {RENTER_FONTS.map((f) => (
            <button key={f.id} type="button" aria-pressed={brand.font === f.id} onClick={() => setBrand({ ...brand, font: f.id })}
              className={cn('rounded-xl border-2 px-3 py-2 text-left', brand.font === f.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200')}>
              <span className="block text-lg leading-tight" style={{ fontFamily: RENTER_FONT_STACK[f.id] }}>{f.label}</span>
              <span className="block text-[9px] font-bold text-slate-500">{f.feel}</span>
            </button>
          ))}
        </div>
      </div>
      <input value={brand.tagline || ''} onChange={(e) => setBrand({ ...brand, tagline: e.target.value.slice(0, 80) })} aria-label="Tagline" placeholder="One line under your name — “Gel & structure, by appointment”"
        className="h-11 w-full rounded-2xl border-2 border-slate-200 px-3 text-sm font-bold" />
      {err && <p className="text-xs font-bold text-red-600">{err}</p>}
      <p className="text-[9px] font-bold text-slate-400">{storageDiagnostic()}</p>
      <div className="flex items-center justify-end gap-2">
        {saved && <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Saved — it&apos;s live</span>}
        <button type="button" onClick={save} disabled={busy} className="h-11 rounded-2xl bg-slate-900 px-5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save my brand'}</button>
      </div>
    </div>
  );
}
export const RENTER_FONT_STACK: Record<string, string> = {
  cormorant: "'Cormorant Garamond', Georgia, serif", lora: "'Lora', Georgia, serif", abril: "'Abril Fatface', Georgia, serif",
  raleway: "'Raleway', system-ui, sans-serif", outfit: "'Outfit', system-ui, sans-serif", jakarta: "'Plus Jakarta Sans', system-ui, sans-serif",
};

// ─── My Packages: prepaid bundles, on their own Stripe ───────────────────────
export function MyPackages({ data, tenantId, token }: { data: any; tenantId: string; token: string }) {
  const [st, setSt] = useState<{ packages: any[]; purchases: any[]; soldCents: number } | null>(null);
  const [draft, setDraft] = useState<any | null>(null);
  const [sell, setSell] = useState<{ packageId: string; clientId: string; note: string } | null>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const services: any[] = data?.myServices || [];
  const canCharge = data?.provider?.chargesEnabled === true;
  const load = useCallback(async () => { const d = await api({ action: 'packages-list', tenantId, token }); if (d?.ok) setSt({ packages: d.packages || [], purchases: d.purchases || [], soldCents: d.soldCents || 0 }); }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (sell && clients.length === 0) api({ action: 'clients-list', tenantId, token }).then((d) => { if (d?.ok) setClients((d.clients || []).filter((c: any) => !c.archived)); }); }, [sell, clients.length, tenantId, token]);
  const save = async () => {
    setBusy(true); setErr('');
    const d = await api({ action: 'package-save', tenantId, token, packageId: draft.id || undefined, name: draft.name, credits: draft.credits, price: draft.price, validDays: draft.validDays, serviceId: draft.serviceId || '', description: draft.description || '', isActive: draft.isActive !== false, noShowForfeits: draft.noShowForfeits !== false, lateCancelForfeits: draft.lateCancelForfeits !== false, lateCancelHours: Number(draft.lateCancelHours ?? 24) });
    setBusy(false); if (!d?.ok) { setErr(d?.error || 'Could not save.'); return; } setDraft(null); void load();
  };
  const doSell = async () => {
    if (!sell?.clientId) { setErr('Pick a client.'); return; }
    setBusy(true); setErr('');
    const d = await api({ action: 'package-sell', tenantId, token, ...sell });
    setBusy(false); if (!d?.ok) { setErr(d?.error || 'Could not record that.'); return; } setSell(null); void load();
  };
  if (!st) return <p className="py-2 text-center text-[11px] font-bold text-slate-400">Loading…</p>;
  const active = st.purchases.filter((p) => p.status === 'active');
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold text-slate-500">Prepaid bundles of your services — “5 gel fills for $300”. Sold on your booking page through your Stripe, or at the chair. A credit comes off each time you mark a visit done. Your money, your Stripe; the studio sees none of it.</p>
      {!canCharge && <p className="rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">Connect your Stripe (Payouts) to sell packages online. Until then you can still record packages sold at the chair.</p>}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{st.packages.length} package{st.packages.length === 1 ? '' : 's'} · ${(st.soldCents / 100).toFixed(0)} sold · {active.length} active</p>
        <button type="button" onClick={() => setDraft({ name: '', credits: 5, price: '', validDays: 365, serviceId: services[0]?.id || '', description: '', isActive: true })} className="h-9 rounded-xl bg-slate-900 px-3 text-[10px] font-black uppercase tracking-widest text-white">New</button>
      </div>
      {draft && (
        <div className="rounded-2xl border-2 border-slate-900 p-3 space-y-2">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 80) })} placeholder="Package name — “5 Gel Fills”" aria-label="Package name" className="h-11 w-full rounded-xl border-2 border-slate-200 px-3 text-sm font-bold" />
          <div className="grid grid-cols-3 gap-2">
            <label className="block"><span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Visits</span><input type="number" min={1} max={50} value={draft.credits} onChange={(e) => setDraft({ ...draft, credits: e.target.value })} className="h-10 w-full rounded-xl border-2 border-slate-200 text-center text-sm font-black" /></label>
            <label className="block"><span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Price $</span><input type="number" min={0} value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} className="h-10 w-full rounded-xl border-2 border-slate-200 text-center text-sm font-black" /></label>
            <label className="block"><span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Valid days</span><input type="number" min={30} max={730} value={draft.validDays} onChange={(e) => setDraft({ ...draft, validDays: e.target.value })} className="h-10 w-full rounded-xl border-2 border-slate-200 text-center text-sm font-black" /></label>
          </div>
          <select value={draft.serviceId} onChange={(e) => setDraft({ ...draft, serviceId: e.target.value })} aria-label="For which service" className="h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-bold">
            <option value="">Any of my services</option>
            {services.map((sv: any) => <option key={sv.id} value={sv.id}>{sv.name} · ${Number(sv.price).toFixed(0)}</option>)}
          </select>
          <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value.slice(0, 300) })} rows={2} placeholder="What's included, who it's for" aria-label="Description" className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm" />
          <div className="rounded-xl border-2 border-slate-200 p-2 space-y-1.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Terms — shown to the client before they buy</p>
            <button type="button" aria-pressed={draft.noShowForfeits !== false} onClick={() => setDraft({ ...draft, noShowForfeits: draft.noShowForfeits === false })} className={cn('h-9 w-full rounded-lg border-2 px-2 text-left text-[10px] font-bold', draft.noShowForfeits !== false ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-200 text-slate-500')}>{draft.noShowForfeits !== false ? 'A no-show uses a visit' : 'A no-show does not use a visit'}</button>
            <div className="flex items-center gap-2">
              <button type="button" aria-pressed={draft.lateCancelForfeits !== false} onClick={() => setDraft({ ...draft, lateCancelForfeits: draft.lateCancelForfeits === false })} className={cn('h-9 flex-1 rounded-lg border-2 px-2 text-left text-[10px] font-bold', draft.lateCancelForfeits !== false ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-200 text-slate-500')}>{draft.lateCancelForfeits !== false ? 'Late cancel uses a visit' : 'Late cancel is free'}</button>
              {draft.lateCancelForfeits !== false && <label className="flex items-center gap-1 text-[10px] font-bold text-slate-600">under <input type="number" min={0} max={168} value={draft.lateCancelHours ?? 24} onChange={(e) => setDraft({ ...draft, lateCancelHours: e.target.value })} className="h-9 w-14 rounded-lg border-2 border-slate-200 text-center text-[11px] font-black" /> h</label>}
            </div>
            <p className="text-[9px] font-bold text-slate-400">If you cancel, decline or move a visit, the client never loses a credit — and one already used comes back.</p>
          </div>
          {draft.name && Number(draft.price) > 0 && Number(draft.credits) > 0 && <p className="text-[10px] font-bold text-slate-500">${(Number(draft.price) / Number(draft.credits)).toFixed(2)} per visit{draft.serviceId && services.find((x: any) => x.id === draft.serviceId) ? ` vs $${Number(services.find((x: any) => x.id === draft.serviceId).price).toFixed(2)} single` : ''}</p>}
          {err && <p className="text-xs font-bold text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy} className="h-11 flex-1 rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save package'}</button>
            <button type="button" onClick={() => setDraft(null)} className="h-11 rounded-2xl border-2 border-slate-200 px-4 text-[10px] font-black uppercase tracking-widest text-slate-600">Cancel</button>
          </div>
        </div>
      )}
      {st.packages.map((p) => (
        <div key={p.id} className={cn('rounded-2xl border-2 p-3', p.isActive === false ? 'border-slate-100 opacity-60' : 'border-slate-200')}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><p className="text-[13px] font-black text-slate-900">{p.name}</p><p className="text-[10px] font-bold text-slate-500">{p.credits} visit{p.credits === 1 ? '' : 's'} · ${(p.priceCents / 100).toFixed(0)}{p.serviceName ? ` · ${p.serviceName}` : ' · any service'} · valid {p.validDays} days{p.isActive === false ? ' · hidden' : ''}</p></div>
            <div className="flex shrink-0 gap-1.5">
              <button type="button" onClick={() => setSell({ packageId: p.id, clientId: '', note: '' })} className="h-8 rounded-lg bg-slate-900 px-2.5 text-[9px] font-black uppercase tracking-widest text-white">Sell at chair</button>
              <button type="button" onClick={() => setDraft({ ...p, price: p.priceCents / 100 })} className="h-8 rounded-lg border-2 px-2.5 text-[9px] font-black uppercase tracking-widest">Edit</button>
            </div>
          </div>
          {sell?.packageId === p.id && (
            <div className="mt-2 space-y-2 rounded-xl border-2 border-slate-200 bg-slate-50 p-2">
              <select value={sell?.clientId || ''} onChange={(e) => setSell((x) => (x ? { ...x, clientId: e.target.value } : x))} aria-label="Client" className="h-10 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-bold">
                <option value="">Which client?</option>
                {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input value={sell?.note || ''} onChange={(e) => setSell((x) => (x ? { ...x, note: e.target.value.slice(0, 200) } : x))} placeholder="How they paid (cash, Venmo…) — for your records" aria-label="Note" className="h-10 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
              {err && <p className="text-xs font-bold text-red-600">{err}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={doSell} disabled={busy} className="h-10 flex-1 rounded-xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">Record sale</button>
                <button type="button" onClick={() => setSell(null)} className="h-10 rounded-xl border-2 border-slate-200 px-3 text-[10px] font-black uppercase tracking-widest text-slate-600">Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
      {st.purchases.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Who holds credits</p>
          {st.purchases.slice(0, 20).map((p) => (
            <p key={p.id} className="text-[11px] font-bold text-slate-600"><span className="font-black text-slate-900">{p.clientName}</span> · {p.packageName} · <span className={cn('font-black', p.status === 'active' ? 'text-emerald-700' : 'text-slate-400')}>{p.remaining} of {p.creditsTotal} left</span>{p.status !== 'active' ? ` · ${p.status}` : ''} · {p.source === 'stripe' ? 'paid online' : 'paid at chair'}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── My Memberships: recurring plans with perks, on their Stripe ─────────────
export function MyMemberships({ data, tenantId, token }: { data: any; tenantId: string; token: string }) {
  const [st, setSt] = useState<{ memberships: any[]; members: any[]; mrrCents: number } | null>(null);
  const [draft, setDraft] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const canCharge = data?.provider?.chargesEnabled === true;
  const [win, setWin] = useState({ horizonDays: Number(data?.provider?.bookingWindow?.horizonDays) || 0, memberHorizonDays: Number(data?.provider?.bookingWindow?.memberHorizonDays) || 0 });
  const [winBusy, setWinBusy] = useState(false);
  const [winSaved, setWinSaved] = useState(false);
  const load = useCallback(async () => { const d = await api({ action: 'memberships-list', tenantId, token }); if (d?.ok) setSt({ memberships: d.memberships || [], members: d.members || [], mrrCents: d.mrrCents || 0 }); }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    setBusy(true); setErr('');
    const d = await api({ action: 'membership-save', tenantId, token, membershipId: draft.id || undefined, name: draft.name, price: draft.price, includedVisits: draft.includedVisits, discountPct: draft.discountPct, perks: String(draft.perksText || '').split('\n').map((x: string) => x.trim()).filter(Boolean), description: draft.description || '', isActive: draft.isActive !== false, noShowForfeits: draft.noShowForfeits !== false, lateCancelForfeits: draft.lateCancelForfeits !== false, lateCancelHours: Number(draft.lateCancelHours ?? 24) });
    setBusy(false); if (!d?.ok) { setErr(d?.error || 'Could not save.'); return; } setDraft(null); void load();
  };
  if (!st) return <p className="py-2 text-center text-[11px] font-bold text-slate-400">Loading…</p>;
  const active = st.members.filter((m) => m.status === 'active');
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold text-slate-500">A monthly plan: visits included, a discount on everything else, and the perks you promise. Billed by Stripe on your account every month.</p>
      <div className="rounded-2xl border-2 border-slate-200 p-3 space-y-2">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Early booking — the perk that actually does something</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Everyone books up to</span><div className="flex items-center gap-1"><input type="number" min={0} max={365} value={win.horizonDays} onChange={(e) => setWin({ ...win, horizonDays: Number(e.target.value) || 0 })} className="h-10 w-full rounded-xl border-2 border-slate-200 text-center text-sm font-black" /><span className="text-[10px] font-bold text-slate-500">days</span></div></label>
          <label className="block"><span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Members up to</span><div className="flex items-center gap-1"><input type="number" min={0} max={365} value={win.memberHorizonDays} onChange={(e) => setWin({ ...win, memberHorizonDays: Number(e.target.value) || 0 })} className="h-10 w-full rounded-xl border-2 border-slate-200 text-center text-sm font-black" /><span className="text-[10px] font-bold text-slate-500">days</span></div></label>
        </div>
        <p className="text-[10px] font-bold text-slate-500">0 = no limit. Members identify by email on your page and get the longer window; the booking engine enforces it. Other perks you list are your promise to keep at the chair.</p>
        <button type="button" disabled={winBusy} onClick={async () => { setWinBusy(true); const d = await api({ action: 'booking-window-save', tenantId, token, ...win }); setWinBusy(false); if (d?.ok) { setWin({ horizonDays: d.horizonDays, memberHorizonDays: d.memberHorizonDays }); setWinSaved(true); setTimeout(() => setWinSaved(false), 1800); } }} className="h-10 w-full rounded-xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{winSaved ? 'Saved' : winBusy ? 'Saving…' : 'Save booking window'}</button>
      </div>
      {!canCharge && <p className="rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">Memberships bill through Stripe — connect yours under Payouts to offer them.</p>}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{active.length} member{active.length === 1 ? '' : 's'} · ${(st.mrrCents / 100).toFixed(0)}/mo</p>
        <button type="button" onClick={() => setDraft({ name: '', price: '', includedVisits: 1, discountPct: 10, perksText: 'Priority booking\nFree nail art on one nail', description: '', isActive: true })} className="h-9 rounded-xl bg-slate-900 px-3 text-[10px] font-black uppercase tracking-widest text-white">New</button>
      </div>
      {draft && (
        <div className="rounded-2xl border-2 border-slate-900 p-3 space-y-2">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, 80) })} placeholder="Plan name — “Gel Club”" aria-label="Plan name" className="h-11 w-full rounded-xl border-2 border-slate-200 px-3 text-sm font-bold" />
          <div className="grid grid-cols-3 gap-2">
            <label className="block"><span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">$ / month</span><input type="number" min={1} value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} className="h-10 w-full rounded-xl border-2 border-slate-200 text-center text-sm font-black" /></label>
            <label className="block"><span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Visits / mo</span><input type="number" min={0} max={31} value={draft.includedVisits} onChange={(e) => setDraft({ ...draft, includedVisits: e.target.value })} className="h-10 w-full rounded-xl border-2 border-slate-200 text-center text-sm font-black" /></label>
            <label className="block"><span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">% off else</span><input type="number" min={0} max={90} value={draft.discountPct} onChange={(e) => setDraft({ ...draft, discountPct: e.target.value })} className="h-10 w-full rounded-xl border-2 border-slate-200 text-center text-sm font-black" /></label>
          </div>
          <label className="block"><span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Perks — one per line, shown to members</span>
            <textarea value={draft.perksText} onChange={(e) => setDraft({ ...draft, perksText: e.target.value.slice(0, 800) })} rows={4} className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm" /></label>
          <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value.slice(0, 300) })} rows={2} placeholder="Who it's for" aria-label="Description" className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm" />
          <div className="rounded-xl border-2 border-slate-200 p-2 space-y-1.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Terms for included visits</p>
            <button type="button" aria-pressed={draft.noShowForfeits !== false} onClick={() => setDraft({ ...draft, noShowForfeits: draft.noShowForfeits === false })} className={cn('h-9 w-full rounded-lg border-2 px-2 text-left text-[10px] font-bold', draft.noShowForfeits !== false ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-200 text-slate-500')}>{draft.noShowForfeits !== false ? 'A no-show uses an included visit' : 'No-shows are forgiven'}</button>
            <div className="flex items-center gap-2">
              <button type="button" aria-pressed={draft.lateCancelForfeits !== false} onClick={() => setDraft({ ...draft, lateCancelForfeits: draft.lateCancelForfeits === false })} className={cn('h-9 flex-1 rounded-lg border-2 px-2 text-left text-[10px] font-bold', draft.lateCancelForfeits !== false ? 'border-slate-900 bg-slate-50 text-slate-900' : 'border-slate-200 text-slate-500')}>{draft.lateCancelForfeits !== false ? 'Late cancel uses a visit' : 'Late cancel is free'}</button>
              {draft.lateCancelForfeits !== false && <label className="flex items-center gap-1 text-[10px] font-bold text-slate-600">under <input type="number" min={0} max={168} value={draft.lateCancelHours ?? 24} onChange={(e) => setDraft({ ...draft, lateCancelHours: e.target.value })} className="h-9 w-14 rounded-lg border-2 border-slate-200 text-center text-[11px] font-black" /> h</label>}
            </div>
          </div>
          {err && <p className="text-xs font-bold text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy} className="h-11 flex-1 rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save plan'}</button>
            <button type="button" onClick={() => setDraft(null)} className="h-11 rounded-2xl border-2 border-slate-200 px-4 text-[10px] font-black uppercase tracking-widest text-slate-600">Cancel</button>
          </div>
        </div>
      )}
      {st.memberships.map((m) => (
        <div key={m.id} className={cn('rounded-2xl border-2 p-3', m.isActive === false ? 'border-slate-100 opacity-60' : 'border-slate-200')}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><p className="text-[13px] font-black text-slate-900">{m.name}</p><p className="text-[10px] font-bold text-slate-500">${(m.priceCents / 100).toFixed(0)}/mo · {m.includedVisits} visit{m.includedVisits === 1 ? '' : 's'} included{m.discountPct ? ` · ${m.discountPct}% off other services` : ''}{m.isActive === false ? ' · hidden' : ''}</p>{(m.perks || []).length > 0 && <p className="mt-0.5 text-[10px] font-bold text-slate-600">{m.perks.join(' · ')}</p>}</div>
            <button type="button" onClick={() => setDraft({ ...m, price: m.priceCents / 100, perksText: (m.perks || []).join('\n') })} className="h-8 shrink-0 rounded-lg border-2 px-2.5 text-[9px] font-black uppercase tracking-widest">Edit</button>
          </div>
        </div>
      ))}
      {st.members.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Members</p>
          {st.members.slice(0, 30).map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2">
              <p className="min-w-0 text-[11px] font-bold text-slate-600"><span className="font-black text-slate-900">{m.clientName}</span> · {m.membershipName} · <span className={cn('font-black', m.status === 'active' ? 'text-emerald-700' : m.status === 'past_due' ? 'text-amber-700' : 'text-slate-400')}>{m.status === 'active' ? `${Math.max(0, (m.includedVisits || 0) - (m.visitsUsedThisPeriod || 0))} of ${m.includedVisits || 0} visits left` : m.status === 'past_due' ? 'card declined — Stripe retrying' : m.status.replace('_', ' ')}</span>{m.cancelAtPeriodEnd ? ' · ending' : m.currentPeriodEnd && m.status === 'active' ? ` · renews ${fmtDate(String(m.currentPeriodEnd).slice(0, 10))}` : ''}</p>
              {m.status !== 'cancelled' && !m.cancelAtPeriodEnd && <button type="button" onClick={async () => { if (!window.confirm(`End ${m.clientName}'s ${m.membershipName} at the end of this period? They keep what they paid for.`)) return; const d = await api({ action: 'membership-cancel', tenantId, token, subscriptionId: m.id }); if (!d?.ok) setErr(d?.error || 'Could not end that.'); void load(); }} className="h-7 shrink-0 rounded-lg border-2 border-slate-200 px-2 text-[9px] font-black uppercase tracking-widest text-slate-500">End</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── My Books: the month, in and out ─────────────────────────────────────────
export function MyBooks({ tenantId, token }: { tenantId: string; token: string }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [led, setLed] = useState<any | null>(null);
  const [exp, setExp] = useState<{ date: string; amount: string; category: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [kpi, setKpi] = useState<any | null>(null);
  const load = useCallback(async () => { const [d, k] = await Promise.all([api({ action: 'ledger', tenantId, token, month }), api({ action: 'kpis', tenantId, token, month })]); if (d?.ok) setLed(d); if (k?.ok) setKpi(k); }, [tenantId, token, month]);
  useEffect(() => { void load(); }, [load]);
  const $ = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
  const shift = (n: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  const label = new Date(`${month}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const saveExp = async () => {
    if (!exp) return; setBusy(true); setErr('');
    const d = await api({ action: 'expense-save', tenantId, token, ...exp }); setBusy(false);
    if (!d?.ok) { setErr(d?.error || 'Could not save.'); return; } setExp(null); void load();
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="h-9 w-9 rounded-xl border-2 border-slate-200 text-[12px] font-black text-slate-600">‹</button>
        <p className="text-[12px] font-black text-slate-900">{label}</p>
        <button type="button" onClick={() => shift(1)} aria-label="Next month" className="h-9 w-9 rounded-xl border-2 border-slate-200 text-[12px] font-black text-slate-600">›</button>
      </div>
      {!led ? <p className="py-2 text-center text-[11px] font-bold text-slate-400">Loading…</p> : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {[['Earned', led.totals.earnedCents, 'text-emerald-700'], ['Rent', -led.totals.rentCents, 'text-slate-700'], ['Expenses', -led.totals.expensesCents, 'text-slate-700'], ['Net', led.totals.netCents, led.totals.netCents >= 0 ? 'text-emerald-800' : 'text-red-700']].map(([l, c, tone]) => (
              <div key={String(l)} className="rounded-2xl border-2 border-slate-100 px-3 py-2"><p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{l}</p><p className={cn('text-[16px] font-black tabular-nums', tone as string)}>{$(Number(c))}</p></div>
            ))}
          </div>
          {kpi && (
            <div className="rounded-2xl border-2 border-slate-100 p-3 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Timing — from the chair clock</p>
              <div className="grid grid-cols-3 gap-2">
                <div><p className="text-[16px] font-black tabular-nums text-slate-900">{kpi.noShowRate}%</p><p className="text-[9px] font-black uppercase tracking-widest text-slate-400">No-show</p></div>
                <div><p className="text-[16px] font-black tabular-nums text-slate-900">{kpi.onTimeRate === null ? '—' : `${kpi.onTimeRate}%`}</p><p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Started on time</p></div>
                <div><p className="text-[16px] font-black tabular-nums text-slate-900">{kpi.chairMinutes ? `${Math.round(kpi.chairMinutes / 6) / 10}h` : '—'}</p><p className="text-[9px] font-black uppercase tracking-widest text-slate-400">In the chair</p></div>
              </div>
              {kpi.services.length === 0 ? (
                <p className="text-[10px] font-bold text-slate-500">Tap Start and Finish on your visits and this fills in: booked vs actual, per service, so you can fix the ones that always run over.</p>
              ) : (
                <div className="space-y-1">
                  {kpi.services.map((sv: any) => (
                    <div key={sv.name} className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-600">
                      <span className="min-w-0 truncate"><span className="font-black text-slate-900">{sv.name}</span> · {sv.n} timed</span>
                      <span className={cn('shrink-0 tabular-nums font-black', sv.driftMin > 5 ? 'text-red-700' : sv.driftMin < -5 ? 'text-amber-700' : 'text-emerald-700')}>{sv.actualAvg} vs {sv.bookedAvg} min · {sv.driftMin > 0 ? '+' : ''}{sv.driftMin}</span>
                    </div>
                  ))}
                  <p className="text-[9px] font-bold text-slate-400">Red runs over the booked time — pad it or price it. Amber finishes early — you may be able to fit more in.</p>
                </div>
              )}
              {kpi.avgLateMin !== null && kpi.avgLateMin > 5 && <p className="text-[10px] font-bold text-amber-700">Visits started {kpi.avgLateMin} min late on average — a buffer between bookings would fix it.</p>}
            </div>
          )}
          <p className="text-[10px] font-bold text-slate-500">Earned = {led.visits.length} completed visit{led.visits.length === 1 ? '' : 's'} at your prices ({$(led.totals.servicesCents)}) + {led.packages.length} package sale{led.packages.length === 1 ? '' : 's'} ({$(led.totals.packagesCents)}). Package-covered visits count $0 on the day — the money came in when the package sold. Tips paid to you directly aren&apos;t tracked here.</p>
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Expenses</p>
            <button type="button" onClick={() => setExp({ date: new Date().toISOString().slice(0, 10), amount: '', category: 'Supplies', note: '' })} className="h-8 rounded-lg bg-slate-900 px-3 text-[9px] font-black uppercase tracking-widest text-white">+ Add</button>
          </div>
          {exp && (
            <div className="rounded-2xl border-2 border-slate-900 p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={exp.date} onChange={(e) => setExp({ ...exp, date: e.target.value })} aria-label="Date" className="h-10 rounded-xl border-2 border-slate-200 px-2 text-sm font-bold" />
                <input type="number" min={0} step="0.01" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} placeholder="Amount $" aria-label="Amount" className="h-10 rounded-xl border-2 border-slate-200 px-2 text-sm font-black" />
              </div>
              <select value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })} aria-label="Category" className="h-10 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-bold">
                {['Supplies', 'Products', 'Equipment', 'Education', 'Marketing', 'Insurance', 'Licence & fees', 'Software', 'Travel', 'Other'].map((c) => <option key={c}>{c}</option>)}
              </select>
              <input value={exp.note} onChange={(e) => setExp({ ...exp, note: e.target.value.slice(0, 200) })} placeholder="What it was" aria-label="Note" className="h-10 w-full rounded-xl border-2 border-slate-200 px-3 text-sm font-bold" />
              {err && <p className="text-xs font-bold text-red-600">{err}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={saveExp} disabled={busy} className="h-10 flex-1 rounded-xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">Save</button>
                <button type="button" onClick={() => setExp(null)} className="h-10 rounded-xl border-2 border-slate-200 px-3 text-[10px] font-black uppercase tracking-widest text-slate-600">Cancel</button>
              </div>
            </div>
          )}
          {led.expenses.length === 0 && !exp && <p className="text-[11px] font-bold text-slate-400">No expenses logged this month.</p>}
          {led.expenses.map((e: any) => (
            <div key={e.id} className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-600">
              <span className="min-w-0 truncate"><span className="font-black text-slate-800">{fmtDate(e.date)}</span> · {e.category}{e.note ? ` · ${e.note}` : ''}</span>
              <span className="flex shrink-0 items-center gap-2 tabular-nums">{$(e.cents)}<button type="button" onClick={async () => { await api({ action: 'expense-delete', tenantId, token, expenseId: e.id }); void load(); }} aria-label="Delete" className="text-slate-400">×</button></span>
            </div>
          ))}
          <details className="pt-1"><summary className="cursor-pointer text-[9px] font-black uppercase tracking-widest text-slate-400">Every line this month</summary>
            <div className="mt-1 space-y-0.5">
              {led.visits.map((v: any) => <p key={v.id} className="text-[10px] font-bold text-slate-600"><span className="font-black text-slate-800">{fmtDate(v.date)}</span> · {v.clientName} · {v.serviceName} · {v.covered ? `covered by ${v.packageName}` : $(v.cents)}</p>)}
              {led.packages.map((p: any) => <p key={p.id} className="text-[10px] font-bold text-emerald-700"><span className="font-black">{fmtDate(p.date)}</span> · {p.clientName} bought {p.packageName} · {$(p.cents)} · {p.source === 'stripe' ? 'online' : 'at chair'}</p>)}
              {led.rent.map((r: any) => <p key={r.id} className="text-[10px] font-bold text-slate-500"><span className="font-black">{fmtDate(r.date)}</span> · rent {r.method} · {$(-r.cents)}</p>)}
            </div>
          </details>
          <button type="button" onClick={() => window.print()} className="h-9 w-full rounded-xl border-2 border-slate-200 text-[9px] font-black uppercase tracking-widest text-slate-600">Print this month</button>
        </>
      )}
    </div>
  );
}

// ─── My Reviews: what clients said, and which ones go public ─────────────────
export function MyReviews({ tenantId, token }: { tenantId: string; token: string }) {
  const [list, setList] = useState<any[] | null>(null);
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState<'pending' | 'published' | 'hidden'>('pending');
  const load = useCallback(async () => { const d = await api({ action: 'reviews-list', tenantId, token }); if (d?.ok) setList(d.reviews || []); }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  if (!list) return <p className="py-2 text-center text-[11px] font-bold text-slate-400">Loading…</p>;
  const counts = { pending: list.filter((r) => r.status === 'pending').length, published: list.filter((r) => r.status === 'published').length, hidden: list.filter((r) => r.status === 'hidden').length };
  const rows = list.filter((r) => r.status === filter);
  const act = async (id: string, status: 'published' | 'hidden') => { setBusy(id); await api({ action: 'review-moderate', tenantId, token, reviewId: id, status }); setBusy(''); void load(); };
  const stars = (n: number) => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(5 - Math.max(0, Math.min(5, n)));
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold text-slate-500">Every review here is from a client who actually completed a visit with you — the ask goes out in your thank-you the day after. Nothing shows on your page until you publish it.</p>
      <div className="flex gap-1.5">
        {(['pending', 'published', 'hidden'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k} className={cn('h-9 rounded-full border-2 px-3 text-[10px] font-black uppercase tracking-widest', filter === k ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600')}>{k === 'pending' ? 'New' : k} · {counts[k]}</button>
        ))}
      </div>
      {rows.length === 0 && <p className="py-3 text-center text-[11px] font-bold text-slate-400">{filter === 'pending' ? 'No new reviews. They arrive after clients get your thank-you.' : `Nothing ${filter}.`}</p>}
      {rows.map((r) => (
        <div key={r.id} className="rounded-2xl border-2 border-slate-200 p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-black text-slate-900">{r.clientName || 'Client'}<span className="font-bold text-slate-500"> · {r.serviceName}</span></p>
            <span className="shrink-0 text-[12px] font-black tracking-tight text-amber-500">{stars(Number(r.rating) || 0)}</span>
          </div>
          {r.text && <p className="text-[12px] font-medium text-slate-700 whitespace-pre-wrap">{r.text}</p>}
          <p className="text-[10px] font-bold text-slate-400">Visited {fmtDate(String(r.visitedAt || r.createdAt).slice(0, 10))}</p>
          <div className="flex gap-2">
            {r.status !== 'published' && <button type="button" disabled={busy === r.id} onClick={() => act(r.id, 'published')} className="h-9 flex-1 rounded-xl bg-emerald-600 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-40">Show on my page</button>}
            {r.status !== 'hidden' && <button type="button" disabled={busy === r.id} onClick={() => act(r.id, 'hidden')} className="h-9 flex-1 rounded-xl border-2 border-slate-200 text-[9px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-40">{r.status === 'published' ? 'Take down' : 'Keep private'}</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── My Page: the content sections on their booking link ─────────────────────
export function MyPage({ tenantId, token, renterId }: { tenantId: string; token: string; renterId: string }) {
  const [page, setPage] = useState<any | null>(null);
  const [open, setOpen] = useState('');
  const [busy, setBusy] = useState('');
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => { const d = await api({ action: 'page-get', tenantId, token }); if (d?.ok) setPage(d.page); }, [tenantId, token]);
  useEffect(() => { void load(); }, [load]);
  if (!page) return <p className="py-2 text-center text-[11px] font-bold text-slate-400">Loading…</p>;
  const upd = (kind: string, patch: any) => setPage((p: any) => ({ ...p, sections: p.sections.map((x: any) => x.kind === kind ? { ...x, ...patch } : x) }));
  const move = (kind: string, dir: -1 | 1) => setPage((p: any) => { const i = p.sections.findIndex((x: any) => x.kind === kind); const j = i + dir; if (j < 0 || j >= p.sections.length) return p; const arr = p.sections.slice(); [arr[i], arr[j]] = [arr[j], arr[i]]; return { ...p, sections: arr }; });
  const save = async () => { setBusy('save'); setErr(''); const d = await api({ action: 'page-save', tenantId, token, page }); setBusy(''); if (!d?.ok) { setErr(d?.error || 'Could not save.'); return; } setPage(d.page); setSaved(true); setTimeout(() => setSaved(false), 1800); };
  const addPhoto = async (kind: string, file?: File) => {
    if (!file) return;
    setBusy('photo'); setErr('');
    try {
      const url = await uploadRenterPhoto(tenantId, token, renterId, 'gallery', file, 1400);
      const next = { ...page, sections: page.sections.map((x: any) => x.kind === kind
        ? { ...x, enabled: true, photos: [ ...(x.photos || []), url ].slice(0, 24) } : x) };
      setPage(next);
      // Persist now, not on Save: the photo is on the page the instant it lands.
      const saved = await api({ action: 'page-save', tenantId, token, page: next });
      if (saved?.ok) { setPage(saved.page); setSaved(true); setTimeout(() => setSaved(false), 1800); }
      else setErr(saved?.error || 'Uploaded, but could not save the page — press Save my page.');
    } catch (ex: any) { setErr(ex?.message || 'Could not upload that photo.'); } finally { setBusy(''); }
  };
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold text-slate-500">What shows on your booking page, under your links and above your menu. Switch a section on, fill it, save. Styling matches the studio so it all feels like one place.</p>
      {page.sections.map((sec: any, i: number) => {
        const def = SECTION_KINDS.find((k) => k.kind === sec.kind);
        const isOpen = open === sec.kind;
        return (
          <div key={sec.kind} className={cn('rounded-2xl border-2', sec.enabled ? 'border-slate-900' : 'border-slate-200')}>
            <div className="flex items-center gap-2 px-3.5 py-3">
              <button type="button" aria-pressed={sec.enabled} onClick={() => upd(sec.kind, { enabled: !sec.enabled })}
                className={cn('h-8 shrink-0 rounded-full px-3 text-[9px] font-black uppercase tracking-widest', sec.enabled ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>{sec.enabled ? 'On' : 'Off'}</button>
              <button type="button" onClick={() => setOpen(isOpen ? '' : sec.kind)} aria-expanded={isOpen} className="min-w-0 flex-1 text-left">
                <span className="block text-[11px] font-black uppercase tracking-widest text-slate-800">{def?.label || sec.kind}</span>
                <span className="block text-[10px] font-bold text-slate-500 truncate">{def?.blurb}</span>
              </button>
              <div className="flex shrink-0 flex-col gap-0.5">
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(sec.kind, -1)} className="h-4 w-7 rounded border text-[9px] font-black text-slate-500 disabled:opacity-30">▲</button>
                <button type="button" aria-label="Move down" disabled={i === page.sections.length - 1} onClick={() => move(sec.kind, 1)} className="h-4 w-7 rounded border text-[9px] font-black text-slate-500 disabled:opacity-30">▼</button>
              </div>
            </div>
            {isOpen && (
              <div className="space-y-2 border-t-2 border-slate-100 px-3.5 py-3">
                <input value={sec.title || ''} onChange={(e) => upd(sec.kind, { title: e.target.value.slice(0, 60) })} aria-label="Section title" placeholder="Section title" className="h-10 w-full rounded-xl border-2 border-slate-200 px-3 text-sm font-bold" />
                {(sec.kind === 'about' || sec.kind === 'policies') && (
                  <textarea value={sec.text || ''} onChange={(e) => upd(sec.kind, { text: e.target.value.slice(0, 2500) })} rows={6} aria-label={`${def?.label} text`}
                    placeholder={sec.kind === 'about' ? "How you got here, what you specialise in, what a first visit is like." : "Deposits, how late is too late, how to cancel, what happens to no-shows."}
                    className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm leading-relaxed" />
                )}
                {sec.kind === 'gallery' && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-1.5">
                      {(sec.photos || []).map((u: string, j: number) => (
                        <button key={u} type="button" onClick={async () => { const next = { ...page, sections: page.sections.map((x: any) => x.kind === sec.kind ? { ...x, photos: x.photos.filter((_: string, k: number) => k !== j) } : x) }; setPage(next); const d = await api({ action: 'page-save', tenantId, token, page: next }); if (d?.ok) setPage(d.page); }} aria-label={`Remove photo ${j + 1}`} className="relative aspect-square overflow-hidden rounded-xl border-2 border-slate-200">
                          <img src={u} alt="" className="h-full w-full object-cover" />
                          <span className="absolute inset-x-0 bottom-0 bg-slate-900/80 text-[8px] font-black uppercase tracking-widest text-white">Remove</span>
                        </button>
                      ))}
                      {(sec.photos || []).length < 24 && (
                        <label className={cn('flex aspect-square cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-[10px] font-black uppercase tracking-widest text-slate-500', busy === 'photo' && 'opacity-50')}>
                          {busy === 'photo' ? '…' : '+ Photo'}
                          <input type="file" accept="image/*" className="sr-only" aria-label="Add a photo" disabled={busy === 'photo'} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void addPhoto(sec.kind, f); }} />
                        </label>
                      )}
                    </div>
                    <p className="text-[9px] font-bold text-slate-400">{(sec.photos || []).length} of 24. Tap a photo to remove it. Your best three go first.</p>
                  </div>
                )}
                {sec.kind === 'faq' && (
                  <div className="space-y-2">
                    {(sec.items || []).map((it: any, j: number) => (
                      <div key={j} className="space-y-1 rounded-xl border-2 border-slate-100 p-2">
                        <input value={it.q} onChange={(e) => upd(sec.kind, { items: sec.items.map((x: any, k: number) => k === j ? { ...x, q: e.target.value.slice(0, 160) } : x) })} aria-label="Question" placeholder="Do you take walk-ins?" className="h-10 w-full rounded-lg border-2 border-slate-200 px-3 text-sm font-bold" />
                        <textarea value={it.a} onChange={(e) => upd(sec.kind, { items: sec.items.map((x: any, k: number) => k === j ? { ...x, a: e.target.value.slice(0, 800) } : x) })} rows={2} aria-label="Answer" placeholder="Answer" className="w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm" />
                        <button type="button" onClick={() => upd(sec.kind, { items: sec.items.filter((_: any, k: number) => k !== j) })} className="text-[9px] font-black uppercase tracking-widest text-slate-400">Remove</button>
                      </div>
                    ))}
                    {(sec.items || []).length < 12 && <button type="button" onClick={() => upd(sec.kind, { items: [ ...(sec.items || []), { q: '', a: '' } ] })} className="h-10 w-full rounded-xl border-2 border-dashed border-slate-300 text-[10px] font-black uppercase tracking-widest text-slate-600">+ Add a question</button>}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {err && <p className="text-xs font-bold text-red-600">{err}</p>}
      <div className="flex items-center justify-end gap-2">
        {saved && <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Saved — it&apos;s live</span>}
        <button type="button" onClick={save} disabled={busy === 'save'} className="h-11 rounded-2xl bg-slate-900 px-5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy === 'save' ? 'Saving…' : 'Save my page'}</button>
      </div>
    </div>
  );
}

// ─── My Services: menu editor + pricing coach ─────────────────────────────────
// The renter's own business tool. Every number here is derived from THEIR rent
// and THEIR hours — the studio never sees these calculations, only the menu
// that results. The lease floor is shown as the agreed term it is, and the
// server enforces it too, so a refused save is never a surprise.
export function MyServices({ data, tenantId, token, onChanged }: { data: any; tenantId: string; token: string; onChanged: () => void }) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hours, setHours] = useState(String(data?.pricing?.bookableHoursPerMonth || 100));
  const [draft, setDraft] = useState<any>(null);

  const pricing = data?.pricing || {};
  const rentPerHour = (Number(pricing.rentPerHourCents) || 0) / 100;
  const floor = (Number(pricing.priceFloorCents) || 0) / 100;
  const services: any[] = data?.myServices || [];

  // When they've told us what they need to live on, the bar becomes THEIR
  // target hourly instead of a generic multiple of rent. Same shape either
  // way, so the UI doesn't branch — only the standard gets more honest.
  const targetHourly = (Number(pricing.targetHourlyCents) || 0) / 100;
  const hasGoals = !!pricing.hasGoals && targetHourly > 0;

  const coach = (price: number, duration: number, productCost: number) => {
    const hrs = Math.max(0.01, (Number(duration) || 60) / 60);
    const rentShare = rentPerHour * hrs;
    const keep = (Number(price) || 0) - rentShare - (Number(productCost) || 0);
    const perHour = keep / hrs;
    const bar = hasGoals ? targetHourly : rentPerHour * 2;
    const tone = keep <= 0 ? 'bad' : perHour < bar ? 'thin' : 'good';
    const monthlyTarget = hasGoals
      ? (Number(pricing.monthlyTargetCents) || 0) / 100
      : (Number(pricing.monthlyRentCents) || 0) / 100;
    const needed = keep > 0 ? Math.ceil(monthlyTarget / keep) : 0;
    return { rentShare, keep, perHour, tone, needed, bar };
  };

  const saveHours = async () => {
    setBusy(true); setErr('');
    const d = await api({ action: 'my-hours', tenantId, token, bookableHoursPerMonth: Number(hours) });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'Could not save'); return; }
    onChanged();
  };

  const saveService = async () => {
    if (!draft) return;
    setBusy(true); setErr('');
    const d = await api({
      action: 'my-service-save', tenantId, token,
      serviceId: draft.id || '', name: draft.name,
      price: Number(draft.price), duration: Number(draft.duration), productCost: Number(draft.productCost || 0),
      depositMode: draft.depositMode || (Number(draft.depositAmount) > 0 ? 'flat' : 'none'),
      depositAmount: Number(draft.depositAmount || 0), depositPercent: Number(draft.depositPercent || 0),
      description: draft.description || '', category: draft.category || '', videoUrl: draft.videoUrl || '',
      ...(draft.imageData === null ? { imageData: null } : {}),
      ...(typeof draft.imageUrl === 'string' && draft.imageUrl ? { imageUrl: draft.imageUrl } : {}),
    });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'Could not save'); return; }
    setDraft(null); onChanged();
  };

  const removeService = async (id: string) => {
    setBusy(true); setErr('');
    const d = await api({ action: 'my-service-remove', tenantId, token, serviceId: id });
    setBusy(false);
    if (!d.ok) { setErr(d.error || 'Could not remove'); return; }
    onChanged();
  };

  const live = draft ? coach(Number(draft.price) || 0, Number(draft.duration) || 60, Number(draft.productCost) || 0) : null;

  return (
    <section className="space-y-3">
      <SectionTitle icon={Sparkles}>My Services</SectionTitle>

      <div className="p-4 rounded-3xl bg-white border-2 space-y-3">
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Your booking link</p>
          <a href={data?.provider?.bookingUrl || '#'} target="_blank" rel="noopener noreferrer"
             className="block truncate text-[11px] font-bold text-slate-700 underline decoration-slate-300 underline-offset-2">
            {data?.provider?.bookingUrl}
          </a>
          <div className="flex gap-2">
            <a href={data?.provider?.bookingUrl || '#'} target="_blank" rel="noopener noreferrer"
               className="h-10 flex-1 inline-flex items-center justify-center rounded-xl border-2 border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-700">
              Open my page
            </a>
            <button type="button" onClick={async () => { try { await navigator.clipboard?.writeText(data?.provider?.bookingUrl || ''); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1800); } catch { /* clipboard blocked — the link is tappable above */ } }}
                    className={cn('h-10 flex-1 rounded-xl px-4 text-[10px] font-black uppercase tracking-widest active:scale-95', linkCopied ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white')}>
              {linkCopied ? 'Copied ✓' : 'Copy link'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-slate-50 p-3 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {hasGoals ? 'What an hour needs to earn' : 'What an hour costs you'}
          </p>
          <p className="text-[13px] font-bold text-slate-700">
            {hasGoals ? (
              <>Your hour needs to make <span className="font-black text-slate-900">${targetHourly.toFixed(2)}</span> — rent, taxes and what you live on, over the hours you book.</>
            ) : (
              <>Your rent works out to <span className="font-black text-slate-900">${rentPerHour.toFixed(2)}/hour</span> in the chair.</>
            )}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-500">Hours you book a month</span>
            <input type="number" min={1} max={400} value={hours} onChange={e => setHours(e.target.value)}
                   className="h-9 w-20 rounded-xl border-2 text-center text-[12px] font-black" />
            <button onClick={saveHours} disabled={busy}
                    className="h-9 rounded-xl border-2 px-3 text-[10px] font-black uppercase tracking-widest disabled:opacity-50">Save</button>
          </div>
        </div>

        {floor > 0 && (
          <p className="text-[11px] font-bold text-slate-500">Your lease sets a ${floor.toFixed(2)} minimum per service.</p>
        )}
        {err && <p className="text-[11px] font-black text-red-600">{err}</p>}

        {services.map((sv: any) => {
          const c = coach(sv.price, sv.duration, sv.productCost);
          return (
            <div key={sv.id} className="rounded-2xl border-2 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-black text-slate-900">{sv.name}</p>
                  <p className="text-[11px] font-bold text-slate-500">${Number(sv.price).toFixed(2)} · {sv.duration} min</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {sv.imageUrl && <img src={sv.imageUrl} alt="" className="h-8 w-8 rounded-lg object-cover border" />}
                  <button onClick={() => setDraft({ ...sv })} className="h-8 rounded-lg border-2 px-3 text-[10px] font-black uppercase tracking-widest">Edit</button>
                  <button onClick={() => removeService(sv.id)} disabled={busy} className="h-8 rounded-lg px-2 text-[10px] font-black uppercase tracking-widest text-slate-400 disabled:opacity-50">Remove</button>
                </div>
              </div>
              <p className={cn('mt-2 text-[11px] font-bold',
                c.tone === 'bad' ? 'text-red-600' : c.tone === 'thin' ? 'text-amber-600' : 'text-emerald-700')}>
                {c.keep <= 0
                  ? `You lose $${Math.abs(c.keep).toFixed(2)} on this one after rent and product.`
                  : `You keep $${c.keep.toFixed(2)} — that's $${c.perHour.toFixed(2)}/hour. ${c.needed} a month ${hasGoals ? 'hits your goal' : 'covers your rent'}.`}
              </p>
            </div>
          );
        })}

        {draft ? (
          <div className="rounded-2xl border-2 border-slate-900 p-3 space-y-2">
            <input placeholder="Service name" value={draft.name || ''} onChange={e => setDraft((d: any) => ({ ...d, name: e.target.value }))}
                   className="h-10 w-full rounded-xl border-2 px-3 text-[13px] font-bold" />
            <div className="flex flex-wrap gap-2">
              <label className="flex-1 min-w-[5rem]">
                <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Price</span>
                <input type="number" min={0} value={draft.price ?? ''} onChange={e => setDraft((d: any) => ({ ...d, price: e.target.value }))}
                       className="h-10 w-full rounded-xl border-2 text-center text-[13px] font-black" />
              </label>
              <label className="flex-1 min-w-[5rem]">
                <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Minutes</span>
                <input type="number" min={5} step={5} value={draft.duration ?? 60} onChange={e => setDraft((d: any) => ({ ...d, duration: e.target.value }))}
                       className="h-10 w-full rounded-xl border-2 text-center text-[13px] font-black" />
              </label>
              <label className="flex-1 min-w-[5rem]">
                <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Product $</span>
                <input type="number" min={0} value={draft.productCost ?? 0} onChange={e => setDraft((d: any) => ({ ...d, productCost: e.target.value }))}
                       className="h-10 w-full rounded-xl border-2 text-center text-[13px] font-black" />
              </label>
            </div>
            <label className="block">
              <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">What it is</span>
              <textarea value={draft.description || ''} onChange={e => setDraft((d: any) => ({ ...d, description: e.target.value.slice(0, 400) }))} rows={3}
                        placeholder="What's included, how long it lasts, who it's for. Clients read this before they book."
                        className="w-full rounded-xl border-2 px-3 py-2 text-[13px]" />
            </label>
            <label className="block">
              <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Video (optional)</span>
              <input value={draft.videoUrl || ''} onChange={e => setDraft((d: any) => ({ ...d, videoUrl: e.target.value.slice(0, 300) }))} inputMode="url"
                     placeholder="YouTube link, or a direct .mp4 — shows when a client opens this service"
                     className="h-10 w-full rounded-xl border-2 px-3 text-[13px] font-bold" />
            </label>
            <div className="flex flex-wrap gap-2">
              <label className="flex-1 min-w-[8rem]">
                <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Category (optional)</span>
                <input value={draft.category || ''} onChange={e => setDraft((d: any) => ({ ...d, category: e.target.value.slice(0, 40) }))} placeholder="Gel, Acrylic, Add-ons…"
                       className="h-10 w-full rounded-xl border-2 px-3 text-[13px] font-bold" />
              </label>
              <div className="flex-1 min-w-[8rem]">
                <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Photo</span>
                <div className="flex items-center gap-2">
                  {(draft.imageData || draft.imageUrl) && draft.imageData !== null && (
                    <img src={draft.imageData || draft.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover border-2" />
                  )}
                  <label className="h-10 flex-1 inline-flex items-center justify-center rounded-xl border-2 border-dashed text-[10px] font-black uppercase tracking-widest text-slate-600 cursor-pointer">
                    {(draft.imageData || draft.imageUrl) && draft.imageData !== null ? 'Change' : 'Add'}
                    <input type="file" accept="image/*" className="sr-only" aria-label="Service photo"
                           onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { const url = await uploadRenterPhoto(tenantId, token, String(data?.renter?.id || ''), 'services', f, 1200); setDraft((x: any) => ({ ...x, imageUrl: url, imageData: undefined })); } catch (ex: any) { setErr(ex?.message || 'Could not upload that photo.'); } }} />
                  </label>
                  {(draft.imageData || draft.imageUrl) && draft.imageData !== null && (
                    <button type="button" onClick={() => setDraft((x: any) => ({ ...x, imageData: null, imageUrl: null }))} aria-label="Remove photo" className="h-10 w-10 rounded-xl border-2 text-slate-500 font-black">×</button>
                  )}
                </div>
              </div>
            </div>
            {data?.provider?.chargesEnabled ? (
              <div className="rounded-xl border-2 p-3 space-y-2">
                <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Deposit to hold the slot</span>
                <div className="flex gap-1.5">
                  {([['none', 'None'], ['flat', 'Fixed $'], ['percent', '% of price']] as const).map(([k, l]) => {
                    const cur = draft.depositMode || (Number(draft.depositAmount) > 0 ? 'flat' : 'none');
                    return <button key={k} type="button" aria-pressed={cur === k} onClick={() => setDraft((d: any) => ({ ...d, depositMode: k }))}
                      className={cn('h-9 flex-1 rounded-full border-2 text-[10px] font-black uppercase tracking-widest', cur === k ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600')}>{l}</button>;
                  })}
                </div>
                {(draft.depositMode || (Number(draft.depositAmount) > 0 ? 'flat' : 'none')) === 'flat' && (
                  <input type="number" min={0} value={draft.depositAmount ?? 0} onChange={e => setDraft((d: any) => ({ ...d, depositAmount: e.target.value }))} aria-label="Deposit in dollars"
                         className="h-10 w-full rounded-xl border-2 text-center text-[13px] font-black" />
                )}
                {(draft.depositMode || 'none') === 'percent' && (
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} max={100} value={draft.depositPercent ?? 25} onChange={e => setDraft((d: any) => ({ ...d, depositPercent: e.target.value }))} aria-label="Deposit percent"
                           className="h-10 w-24 rounded-xl border-2 text-center text-[13px] font-black" />
                    <span className="text-[11px] font-bold text-slate-500">% = ${(((Number(draft.price) || 0) * (Number(draft.depositPercent ?? 25) || 0)) / 100).toFixed(2)} on this service</span>
                  </div>
                )}
                <p className="text-[10px] font-bold text-slate-400">Goes straight to your Stripe when they book. The rest they pay you at the visit.</p>
              </div>
            ) : (
              <p className="text-[10px] font-bold text-slate-400">Connect your Stripe below to start taking deposits and stop losing no-shows.</p>
            )}
            {live && (
              <div className={cn('rounded-xl p-3',
                live.tone === 'bad' ? 'bg-red-50' : live.tone === 'thin' ? 'bg-amber-50' : 'bg-emerald-50')}>
                <p className={cn('text-[12px] font-black',
                  live.tone === 'bad' ? 'text-red-700' : live.tone === 'thin' ? 'text-amber-700' : 'text-emerald-800')}>
                  {live.keep <= 0
                    ? `At this price you lose $${Math.abs(live.keep).toFixed(2)} each time.`
                    : `You keep $${live.keep.toFixed(2)} — $${live.perHour.toFixed(2)}/hour.`}
                </p>
                <p className="mt-1 text-[11px] font-bold text-slate-600">
                  Rent share ${live.rentShare.toFixed(2)}{Number(draft.productCost) > 0 ? ` · product $${Number(draft.productCost).toFixed(2)}` : ''}
                  {live.needed > 0 ? ` · ${live.needed} a month covers your rent` : ''}
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={saveService} disabled={busy}
                      className="h-10 flex-1 rounded-xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white active:scale-95 disabled:opacity-50">
                {busy ? 'Saving…' : 'Save service'}
              </button>
              <button onClick={() => { setDraft(null); setErr(''); }} className="h-10 rounded-xl border-2 px-4 text-[10px] font-black uppercase tracking-widest">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setDraft({ name: '', price: '', duration: 60, productCost: 0 })}
                  className="h-11 w-full rounded-2xl border-2 border-dashed text-[10px] font-black uppercase tracking-widest text-slate-500">
            ＋ Add a service
          </button>
        )}
      </div>
    </section>
  );
}
