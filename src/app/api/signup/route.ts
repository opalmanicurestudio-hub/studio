'use client';
// src/app/(auth)/signup/page.tsx
//
// SET UP YOUR BUSINESS — sign-up as a short journey, in the landing page's world:
//
//   1 What do you run?     business type, name, just me / a team
//   2 What do you need?    the à la carte tools (recommended pre-selected)
//   3 And you?             name, email, phone, password
//   4 Building…            each step ticks off as it really happens, then
//                          → Your ClarityFlow (/subscriptions)
//
// The account and business are created ON THE SERVER (/api/signup), with the
// same defaults as always plus the business type and chosen tools. The page
// only collects the answers and signs in with the token it gets back.

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { Eye, EyeOff, Loader, ArrowLeft } from 'lucide-react';
import { Wordmark } from '@/components/auth/AuthBackdrop';
import { ToolPicker } from '@/components/modules/ToolPicker';
import { RECOMMENDED, hoursFor, TOOL_BY_ID, type ToolId } from '@/lib/module-catalog';

const TYPES: [string, string, string][] = [
  ['salon', '✂️', 'Salon or suites'], ['spa', '🌿', 'Spa or wellness'], ['fitness', '🧘', 'Fitness studio'], ['tattoo', '🖋️', 'Tattoo or piercing'],
  ['shop', '🏺', 'Shop or maker'], ['events', '🎉', 'Events or venue'], ['hospitality', '☕', 'Café or lounge'], ['other', '✦', 'Something else'],
];
const field = 'h-12 w-full rounded-2xl border border-white/80 bg-white/70 px-4 text-[15px] outline-none transition focus:bg-white focus:ring-2 focus:ring-stone-300';

function Signup() {
  const router = useRouter();
  const sp = useSearchParams();
  const [step, setStep] = useState(0);
  const [type, setType] = useState<string>(() => { const t = sp?.get('type') || ''; return TYPES.some(([k]) => k === t) ? t : ''; });
  const [businessName, setBusinessName] = useState('');
  const [teamSize, setTeamSize] = useState<'solo' | 'team'>('solo');
  const [tools, setTools] = useState<ToolId[]>(() => {
    const fromUrl = String(sp?.get('tools') || '').split(',').filter((x) => TOOL_BY_ID[x as ToolId]) as ToolId[];
    return fromUrl.length ? Array.from(new Set(['booking', ...fromUrl])) as ToolId[] : (RECOMMENDED.other as ToolId[]);
  });
  const [toolsTouched, setToolsTouched] = useState(false);
  const [me, setMe] = useState({ name: '', email: '', phone: '', password: '' });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [building, setBuilding] = useState<number>(-1);
  // Early access is by invite unless NEXT_PUBLIC_SIGNUP_OPEN=true.
  const inviteOnly = String(process.env.NEXT_PUBLIC_SIGNUP_OPEN || '').toLowerCase() !== 'true';
  const [invite, setInvite] = useState(() => String(sp?.get('invite') || '').toUpperCase());
  const [inviteOk, setInviteOk] = useState(false);
  const [checking, setChecking] = useState(false);
  const checkInvite = async (quiet = false) => {
    if (!inviteOnly) return true;
    setChecking(true); if (!quiet) setErr('');
    try {
      const r = await fetch('/api/invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check', code: invite }) });
      const d = await r.json().catch(() => null);
      if (d?.ok) {
        setInviteOk(true);
        if (d.business && !businessName) setBusinessName(d.business);
        if (d.type && !type && TYPES.some(([k]) => k === d.type)) setType(d.type);
        if (d.email && !me.email) setMe((m) => ({ ...m, email: d.email }));
        return true;
      }
      if (!quiet) setErr(d?.error || 'That invite code didn’t work.');
      return false;
    } catch { if (!quiet) setErr('Couldn’t check your invite — check your connection.'); return false; }
    finally { setChecking(false); }
  };
  useEffect(() => { if (inviteOnly && invite.length >= 4) void checkInvite(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (type && !toolsTouched && !sp?.get('tools')) setTools(RECOMMENDED[type] as ToolId[]); }, [type, toolsTouched, sp]);

  const label = TYPES.find(([k]) => k === type)?.[2] || '';
  const pwOk = me.password.length >= 6;
  const canNext = step === 0 ? !!type && businessName.trim().length >= 2 && (!inviteOnly || invite.trim().length >= 4) : step === 1 ? tools.length > 0 : me.name.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(me.email) && me.phone.replace(/\D/g, '').length >= 7 && pwOk;
  const steps = useMemo(() => ['Creating your account', `Setting up ${businessName.trim() || 'your business'}`, `Turning on ${tools.length} tools`, 'Opening your booking page'], [businessName, tools.length]);

  // Everything happens on the server (/api/signup): the invite is checked and
  // reserved, the account and business are created, and we get back a
  // one-time token to sign in with. The browser can't create accounts itself.
  const create = async () => {
    setErr(''); setBuilding(0);
    const tick = window.setInterval(() => setBuilding((x) => (x >= 0 && x < 2 ? x + 1 : x)), 900);
    try {
      const r = await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite, type, businessName: businessName.trim(), teamSize, tools, name: me.name.trim(), email: me.email.trim(), phone: me.phone.trim(), password: me.password }) });
      const d = await r.json().catch(() => null);
      window.clearInterval(tick);
      if (!d?.ok || !d.token) throw new Error(d?.error || 'Something went wrong creating your account. Try again.');
      setBuilding(2);
      await signInWithCustomToken(getAuth(), d.token);
      setBuilding(3);
      await new Promise((res) => setTimeout(res, 600));
      setBuilding(4);
      await new Promise((res) => setTimeout(res, 400));
      router.push('/subscriptions');
    } catch (e: any) {
      window.clearInterval(tick);
      setBuilding(-1);
      setErr(String(e?.message || 'Something went wrong creating your account. Try again.'));
      setStep(/invite/i.test(String(e?.message || '')) ? 0 : 2);
    }
  };

  // ── Building ──
  if (building >= 0) return (
    <div className="flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-sm text-center">
        <p className="text-3xl font-light tracking-tight">Building <span className="font-semibold">your ClarityFlow</span></p>
        <div className="glass mt-8 space-y-3 rounded-[2rem] p-6 text-left">
          {steps.map((s, i) => (
            <div key={s} className={`flex items-center gap-3 transition-opacity duration-500 ${i <= building ? 'opacity-100' : 'opacity-35'}`}>
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] ${i < building ? 'bg-emerald-600 text-white' : i === building ? 'bg-stone-900 text-white' : 'bg-white/70 text-stone-400'}`}>
                {i < building ? '✓' : i === building ? <Loader className="h-3.5 w-3.5 animate-spin" /> : i + 1}
              </span>
              <span className="text-[15px]">{s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const titles = [['What do you', 'run?'], ['What do you', 'need?'], ['And', 'you?']];
  return (
    <div className="flex min-h-dvh flex-col px-5 py-6">
      <style>{`.cf-step{animation:cf-step .7s cubic-bezier(.22,1,.36,1) both}@keyframes cf-step{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion: reduce){.cf-step{animation:none}}`}</style>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <Link href="/" className="text-lg"><Wordmark /></Link>
        <Link href="/login" className="text-sm text-stone-600">Sign in</Link>
      </header>

      <main className={`mx-auto w-full flex-1 py-8 ${step === 1 ? 'max-w-5xl' : 'max-w-md'}`}>
        {/* Progress */}
        <div className="mx-auto flex max-w-md items-center gap-2" aria-label={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((i) => <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${i <= step ? 'bg-stone-900' : 'bg-stone-300/70'}`} />)}
        </div>

        <div key={step} className="cf-step">
          <h1 className="mt-8 text-center text-4xl font-light tracking-tight sm:text-5xl">{titles[step][0]} <span className="font-semibold">{titles[step][1]}</span></h1>

          {step === 0 && (
            <div className="mt-8 space-y-4">
              {inviteOnly && (
                <div className={`rounded-3xl p-4 ${inviteOk ? 'bg-emerald-50' : 'glass'}`}>
                  <p className="text-[13px] text-stone-600">{inviteOk ? '✓ Invite accepted — welcome.' : 'ClarityFlow is in early access. Enter the invite code from your email.'}</p>
                  {!inviteOk && <input value={invite} onChange={(e) => { setInvite(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')); setErr(''); }} placeholder="Invite code" autoComplete="off" className={field + ' mt-2 font-mono tracking-[0.15em]'} />}
                  {!inviteOk && <p className="mt-2 text-[12px] text-stone-500">No code yet? <Link href="/request-access" className="font-medium text-stone-900 underline-offset-2 hover:underline">Request access</Link></p>}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {TYPES.map(([k, e, l]) => (
                  <button key={k} type="button" onClick={() => setType(k)} aria-pressed={type === k}
                    className={`rounded-3xl p-4 text-left transition-all ${type === k ? 'bg-stone-900 text-white shadow-[0_14px_30px_-16px_rgba(28,25,23,0.8)]' : 'glass text-stone-800'} ${k === 'other' ? 'col-span-2' : ''}`}>
                    <span className="text-2xl" aria-hidden>{e}</span><span className="mt-1 block text-[15px] font-medium">{l}</span>
                  </button>
                ))}
              </div>
              <input value={businessName} onChange={(e) => setBusinessName(e.target.value.slice(0, 80))} placeholder="Business name" autoComplete="organization" className={field} />
              <div className="grid grid-cols-2 gap-2">
                {([['solo', 'Just me'], ['team', 'A team']] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setTeamSize(k)} aria-pressed={teamSize === k} className={`h-12 rounded-2xl text-sm ${teamSize === k ? 'bg-stone-900 text-white' : 'glass text-stone-700'}`}>{l}</button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="mt-8">
              <p className="mx-auto mb-6 max-w-lg text-center text-stone-600">We’ve switched on what a {label.toLowerCase() || 'business like yours'} usually needs. Turn tools on or off — you can change this any time.</p>
              <ToolPicker value={tools} onChange={(v) => { setTools(v); setToolsTouched(true); }} niche={type || 'other'} nicheLabel={label} />
            </div>
          )}

          {step === 2 && (
            <div className="glass mt-8 space-y-3 rounded-[2rem] p-5 sm:p-6">
              <input value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} placeholder="Your name" autoComplete="name" className={field} />
              <input value={me.email} onChange={(e) => setMe({ ...me, email: e.target.value })} type="email" placeholder="Email" autoComplete="email" className={field} />
              <input value={me.phone} onChange={(e) => setMe({ ...me, phone: e.target.value })} type="tel" placeholder="Mobile number" autoComplete="tel" className={field} />
              <div className="relative">
                <input value={me.password} onChange={(e) => setMe({ ...me, password: e.target.value })} type={show ? 'text' : 'password'} placeholder="Create a password" autoComplete="new-password" className={field + ' pr-12'} />
                <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-stone-400">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
              <p className={`px-1 text-[12px] ${pwOk ? 'text-emerald-700' : 'text-stone-500'}`}>{pwOk ? '✓ Good to go' : 'At least 6 characters'}</p>
              <div className="rounded-2xl bg-white/60 p-3 text-[13px] text-stone-600">
                <span className="font-medium text-stone-900">{businessName || 'Your business'}</span> · {new Set(['booking', 'guest', ...tools]).size} tools · gives back about {hoursFor(Array.from(new Set(['booking', 'guest', ...tools])) as ToolId[])} hrs a week
              </div>
            </div>
          )}

          {err && <p className="mx-auto mt-4 max-w-md rounded-2xl bg-red-50 px-4 py-3 text-[13px] text-red-800">{err}{err.includes('sign in') && <> <Link href="/login" className="font-medium underline">Sign in</Link></>}</p>}

          <div className="mx-auto mt-8 flex max-w-md items-center gap-3">
            {step > 0 && <button type="button" onClick={() => { setStep(step - 1); setErr(''); }} className="glass flex h-12 w-12 shrink-0 items-center justify-center rounded-full" aria-label="Back"><ArrowLeft className="h-4 w-4" /></button>}
            <button type="button" disabled={!canNext || checking} onClick={async () => { if (step === 0 && inviteOnly && !inviteOk && !(await checkInvite())) return; step < 2 ? setStep(step + 1) : create(); }}
              className="h-12 flex-1 rounded-full bg-stone-900 text-sm font-medium text-white shadow-[0_12px_30px_-12px_rgba(28,25,23,0.6)] disabled:opacity-40">
              {step < 2 ? 'Continue' : 'Build my ClarityFlow'}
            </button>
          </div>
          {step === 0 && <p className="mt-5 text-center text-sm text-stone-600">Just looking? <Link href={`/demo${type && type !== 'other' ? `?type=${type}` : ''}`} className="font-medium text-stone-900 underline-offset-2 hover:underline">Try the live demo</Link></p>}
        </div>
      </main>
    </div>
  );
}

export default function SignupPage() {
  return <Suspense fallback={null}><Signup /></Suspense>;
}
