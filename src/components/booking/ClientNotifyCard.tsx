'use client';
// src/components/booking/ClientNotifyCard.tsx — "GET UPDATES HERE, NOT BY TEXT" on the client's visit link.
// One button: permission (asked right at the tap), this phone's notification address, saved through /api/appt
// ('push_register'). On iPhone in the browser it shows the Add to Home Screen steps instead, because iPhone only
// allows notifications from a saved home screen app. Hidden where the browser can't show notifications at all.
import React from 'react';
import { getDeviceToken } from '@/lib/push-client';
import { VisitCard, VisitButton, VisitMuted } from '@/components/booking/VisitShell';

const isIPhone = () => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
export const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);
export function platformOf(): string {
  if (typeof navigator === 'undefined') return 'Other';
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  return 'Other';
}
const keyOf = (tenantId: string) => `cf_client_push_${tenantId}`;
const readToken = (tenantId: string): string | null => { try { return localStorage.getItem(keyOf(tenantId)); } catch { return null; } };
const writeToken = (tenantId: string, token: string | null) => { try { if (token) localStorage.setItem(keyOf(tenantId), token); else localStorage.removeItem(keyOf(tenantId)); } catch { /* private mode */ } };

/** Whether this phone already has notifications on for this business (as remembered on the device). */
export function clientPushOn(tenantId: string): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  return Notification.permission === 'granted' && !!readToken(tenantId);
}

type View = 'off' | 'on' | 'blocked' | 'home_screen' | 'hidden';

export function ClientNotifyCard({ tenantId, api, hideWhenOn }: { tenantId: string; api: (payload: any) => Promise<any>; hideWhenOn?: boolean }) {
  const [view, setView] = React.useState<View | null>(null);
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  React.useEffect(() => {
    if (isIPhone() && !isStandalone()) { setView('home_screen'); return; }
    if (!('Notification' in window) || !('serviceWorker' in navigator)) { setView('hidden'); return; }
    if (Notification.permission === 'denied') { setView('blocked'); return; }
    setView(clientPushOn(tenantId) ? 'on' : 'off');
  }, [tenantId]);
  if (!view || view === 'hidden' || (hideWhenOn && view === 'on')) return null;

  const turnOn = async () => {
    setBusy(true); setErr('');
    const d = await getDeviceToken();   // first thing in the tap: iPhone only allows the question here
    if (!d.token) { setBusy(false); if (d.state === 'blocked') setView('blocked'); else if (d.state === 'unsupported') setView('hidden'); else if (d.error) setErr(d.error); return; }
    const r = await api({ action: 'push_register', token: d.token, platform: platformOf(), standalone: isStandalone() });
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'We couldn’t turn on notifications. Please try again.'); return; }
    writeToken(tenantId, d.token); setView('on');
  };
  const turnOff = async () => {
    setBusy(true); setErr('');
    const token = readToken(tenantId);
    const r = token ? await api({ action: 'push_remove', token }) : { ok: true };
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'We couldn’t turn off notifications. Please try again.'); return; }
    writeToken(tenantId, null); setView('off');
  };

  return (
    <VisitCard>
      {view === 'on' ? <>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[15px]">Notifications are on for this phone.</p>
          <button type="button" disabled={busy} onClick={turnOff} className="shrink-0 text-[14px] underline underline-offset-2 disabled:opacity-50" style={{ color: 'var(--muted)' }}>{busy ? 'Turning off…' : 'Turn off'}</button>
        </div>
      </> : <>
        <p className="text-[16px] font-semibold">Get updates here, not by text</p>
        {view === 'home_screen' ? <VisitMuted>On iPhone: tap Share, then Add to Home Screen, then open it from your home screen and turn on notifications here.</VisitMuted>
          : view === 'blocked' ? <VisitMuted>Notifications are blocked for this page. To turn them on, please allow notifications in your phone’s settings, then come back.</VisitMuted>
          : <>
            <VisitMuted>Turn on notifications for replies, reminders and early openings.</VisitMuted>
            <VisitButton quiet onClick={turnOn} disabled={busy}>{busy ? 'Turning on…' : 'Turn on notifications'}</VisitButton>
          </>}
      </>}
      {err && <p className="text-[14px]" style={{ color: '#b42318' }}>{err}</p>}
    </VisitCard>
  );
}
