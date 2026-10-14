'use client';
// src/components/shared/IdleSignOut.tsx — HEALTH INFORMATION MODE: SIGN STAFF OUT OF AN IDLE SCREEN.
// When the business has health information mode on (Settings → Booking policies → Privacy), a screen left with no tap,
// click, key press or scroll for the business's chosen minutes (lib/health-privacy privacyOf → autoSignOutMin) signs
// out, the same way the sidebar's Sign out does. One minute before, a "Still there?" notice gives them the chance to stay.
// Activity in any open tab of the app counts (shared through localStorage), so a second tab doesn't sign out the first.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { useAuth } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { privacyOf } from '@/lib/health-privacy';

const KEY = 'cf:lastActivity'; const WARN_MS = 60000;
const readLast = (fallback: number) => { try { const v = Number(localStorage.getItem(KEY)); return Number.isFinite(v) && v > 0 ? Math.max(v, fallback) : fallback; } catch { return fallback; } };

export function IdleSignOut() {
  const { selectedTenant } = useTenant() as any;
  const auth = useAuth(); const router = useRouter();
  const pv = privacyOf(selectedTenant); const limitMs = pv.healthMode ? pv.autoSignOutMin * 60000 : 0;
  const last = React.useRef(Date.now()); const [left, setLeft] = React.useState<number | null>(null); const out = React.useRef(false);

  const stay = React.useCallback(() => { last.current = Date.now(); try { localStorage.setItem(KEY, String(last.current)); } catch { /* fine */ } setLeft(null); }, []);
  const doSignOut = React.useCallback(async () => {
    if (out.current || !auth) return; out.current = true;
    const tenantId = selectedTenant?.id;
    if (tenantId) await import('@/lib/push-client').then(({ releasePush }) => releasePush(tenantId)).catch(() => {});
    await signOut(auth).catch(() => {}); router.push('/login');
  }, [auth, router, selectedTenant?.id]);

  React.useEffect(() => {
    if (!limitMs) { setLeft(null); return; }
    out.current = false; stay();
    let lastWrite = 0;
    const onActivity = () => { const now = Date.now(); last.current = now; if (now - lastWrite > 5000) { lastWrite = now; try { localStorage.setItem(KEY, String(now)); } catch { /* fine */ } } };
    const evs = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    evs.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const tick = window.setInterval(() => {
      const idle = Date.now() - readLast(last.current); const remain = limitMs - idle;
      if (remain <= 0) { void doSignOut(); return; }
      setLeft(remain <= WARN_MS ? Math.ceil(remain / 1000) : null);
    }, 1000);
    return () => { evs.forEach((e) => window.removeEventListener(e, onActivity)); window.clearInterval(tick); };
  }, [limitMs, stay, doSignOut]);

  if (left === null) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="idle-title" className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(28,25,23,.45)' }}>
      <div className="w-full max-w-sm space-y-3 rounded-t-[28px] p-5 sm:rounded-[26px]" style={{ background: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }}>
        <h2 id="idle-title" className="text-[20px] font-light">Still there?</h2>
        <p className="text-[14px]" style={{ color: 'hsl(var(--muted-foreground))' }}>To keep client information private, you’ll be signed out in {left} second{left === 1 ? '' : 's'}.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" autoFocus onClick={stay} className="h-10 rounded-full px-5 text-[14px] font-semibold" style={{ background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' }}>I’m still here</button>
          <button type="button" onClick={() => void doSignOut()} className="h-10 rounded-full px-5 text-[14px] font-semibold" style={{ background: 'hsl(var(--secondary))' }}>Sign out now</button>
        </div>
      </div>
    </div>);
}
