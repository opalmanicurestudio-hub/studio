'use client';
// src/app/academy-screen/page.tsx
//
// THE CLOCK-IN SCREEN — leave it open on a tablet or TV at the academy.
// The QR code changes every 30 seconds, so a photo of it can't be used later
// or from home. Students scan it with their own signed-in phone.
// Opened by an owner, manager or instructor (it needs their sign-in).

import { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import QRCode from 'qrcode';
import { useTenant } from '@/context/TenantContext';

export default function AcademyScreen() {
  const { selectedTenant } = useTenant();
  const tenantId = String(selectedTenant?.id || '');
  const [qr, setQr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [now, setNow] = useState(new Date());

  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    if (!tenantId) return;
    let timer: number | null = null; let alive = true;
    const refresh = async () => {
      try {
        const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
        const r = await fetch('/api/academy/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ action: 'attendance-code', tenantId }) });
        const d = await r.json();
        if (!alive) return;
        if (!d.ok) { setErr(d.error || 'Sign in as an owner, manager or instructor.'); timer = window.setTimeout(refresh, 15000); return; }
        setErr(''); setName(d.name); setQr(await QRCode.toDataURL(d.url, { margin: 1, width: 720, errorCorrectionLevel: 'M' }));
        timer = window.setTimeout(refresh, Math.max(3, d.refreshInSec + 1) * 1000);
      } catch { if (alive) timer = window.setTimeout(refresh, 10000); }
    };
    const unsub = getAuth().onAuthStateChanged((u) => { if (u) void refresh(); });
    return () => { alive = false; unsub(); if (timer) window.clearTimeout(timer); };
  }, [tenantId]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-[#f7f5f2] p-8 text-center text-stone-900">
      <p className="text-2xl font-light tracking-tight sm:text-4xl">{name || selectedTenant?.name} <span className="font-semibold">Academy</span></p>
      <p className="font-mono text-5xl font-light tabular-nums sm:text-7xl">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</p>
      <div className="rounded-[2rem] bg-white p-6 shadow-[0_30px_80px_-40px_rgba(28,25,23,0.5)]">
        {qr ? <img src={qr} alt="Scan to clock in or out" className="h-[min(60vh,60vw)] w-[min(60vh,60vw)]" /> : <div className="flex h-72 w-72 items-center justify-center text-stone-400">{err || 'Loading…'}</div>}
      </div>
      <p className="text-2xl font-semibold sm:text-3xl">Scan to clock in or out</p>
      <p className="max-w-lg text-stone-600">Use your phone’s camera, signed in with the email you enrolled with. The code changes every 30 seconds.</p>
      {err && qr && <p className="text-sm text-red-700">{err}</p>}
    </div>
  );
}
