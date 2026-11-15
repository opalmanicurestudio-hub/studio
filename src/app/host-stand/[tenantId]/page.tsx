'use client';
// src/app/host-stand/[tenantId]/page.tsx — THE HOST STAND'S TABLET, SET UP ONCE (design canvas "The floor's phones").
// A manager signs in here once and sets the tablet up (api/kitchen 'pair', kind 'host'); its key stays on the tablet.
// From then on the tablet signs itself in as the host stand (api/kitchen 'hostToken'): the host stand, Clear tables and
// My tables work on it under its own name, with nobody's account left signed in. Opened again later (the browser was
// closed, the sign-in ran out), it signs itself back in. A manager stops it from here on another device, or from the
// kitchen screen's set-up page.
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { useFirebase } from '@/firebase';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const btn = 'min-h-[44px] rounded-xl px-4 text-[15px] font-semibold disabled:opacity-50';
const keyName = (t: string) => `cf.hoststand.${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* */ } };

export default function HostStandTablet() {
  const { tenantId } = useParams() as { tenantId: string };
  const { user, isUserLoading } = useFirebase() as any;
  const [stage, setStage] = useState<'start' | 'setup' | 'signing'>('start');
  const [name, setName] = useState('Host stand'); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const call = async (body: any) => { const r = await fetch('/api/kitchen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, ...body }) }); return { status: r.status, d: await r.json().catch(() => ({})) as any }; };

  // With its key: sign in as the host stand and open it.
  const signInAs = async (key: string) => {
    setStage('signing'); setErr('');
    try {
      const { status, d } = await call({ action: 'hostToken', key });
      if (!d.ok) { if (status === 401) write(keyName(tenantId), null); setErr(d.error || 'This tablet couldn’t sign in. Try again.'); setStage('setup'); return; }
      const auth = getAuth(); if (auth.currentUser) await signOut(auth).catch(() => {});
      await signInWithCustomToken(auth, String(d.token));
      window.location.replace('/host');
    } catch { setErr('No connection. Try again.'); setStage('setup'); }
  };
  useEffect(() => { const k = read(keyName(tenantId)); if (k) void signInAs(k); else setStage('setup'); }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setUp = async () => {
    setBusy(true); setErr('');
    const { d } = await call({ action: 'pair', name, kind: 'host' }).catch(() => ({ d: { ok: false, error: 'No connection. Try again.' } as any }));
    setBusy(false);
    if (!d.ok || !d.key) { setErr(d.error || 'That didn’t go through. Try again.'); return; }
    write(keyName(tenantId), String(d.key)); void signInAs(String(d.key));
  };

  const next = typeof window !== 'undefined' ? window.location.pathname : `/host-stand/${tenantId}`;
  return (
    <main className="min-h-dvh flex items-center justify-center p-4" style={{ background: SOFT, color: INK }}>
      <div className="w-full max-w-md rounded-3xl bg-[#fff] p-6 space-y-4" style={{ border: `1px solid ${LINE}` }}>
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">Set up the host stand</h1>
          <p className="mt-1.5 text-[15px] leading-relaxed" style={{ color: MUTED }}>A manager sets this tablet up once. After that it keeps working when they sign out, like the kitchen screen. What it does is done as the host stand.</p>
        </div>
        {err && <p role="alert" className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
        {stage !== 'setup' || isUserLoading ? (
          <div className="flex items-center gap-3 py-2" role="status"><div className="h-6 w-6 animate-spin rounded-full border-[3px]" style={{ borderColor: LINE, borderTopColor: INK }} /><span className="text-[15px]">Opening the host stand…</span></div>
        ) : user ? (
          <div className="space-y-3">
            <label className="block"><span className="text-[14px] font-medium">Name this tablet</span>
              <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} className="mt-1.5 min-h-[44px] w-full rounded-xl px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ border: `1px solid ${LINE}` }} /></label>
            <button type="button" onClick={setUp} disabled={busy} className={`${btn} w-full`} style={{ background: INK, color: '#fff' }}>{busy ? 'Setting up…' : 'Set up this tablet'}</button>
            <p className="text-[13px]" style={{ color: MUTED }}>Signed in as {user.email || 'you'}. Only an owner or manager can set up the host stand. Setting it up signs your account out of this tablet. Stop it any time from the kitchen screen’s set-up page on another device.</p>
          </div>
        ) : (
          <a href={`/login?next=${encodeURIComponent(next)}`} className={`${btn} flex w-full items-center justify-center`} style={{ background: INK, color: '#fff' }}>Sign in to set it up</a>
        )}
      </div>
    </main>
  );
}
