'use client';
// src/components/shared/PushPrompt.tsx — "GET NOTIFICATIONS ON THIS PHONE". A plain status and one button.
// `dark` for the staff portal (hidden once on), `light` for the main app's notifications panel (shows "On" once on).
import * as React from 'react';
import { enablePush, pushState, type PushState } from '@/lib/push-client';

const TEXT: Record<PushState, string> = {
  on: 'Notifications are on for this phone.',
  off: 'Get a buzz on this phone for walk-ins, messages and requests.',
  blocked: 'Notifications are blocked for this app. Turn them on in your phone’s Settings, then come back.',
  unsupported: 'This browser can’t show notifications. Try Chrome, or Safari from your Home Screen.',
  needs_home_screen: 'On iPhone: tap Share → Add to Home Screen, then open the app from that icon and turn notifications on there.',
};

export function PushPrompt({ tenantId, tone = 'light' }: { tenantId: string; tone?: 'dark' | 'light' }) {
  const [state, setState] = React.useState<PushState | null>(null); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  React.useEffect(() => { setState(pushState()); }, []);
  if (!state || (tone === 'dark' && state === 'on')) return null;
  const dark = tone === 'dark';
  return (
    <div className={dark ? 'flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3' : 'flex flex-wrap items-center gap-3 rounded-xl px-4 py-3'} style={dark ? undefined : { background: '#f3eee8' }}>
      <p className={dark ? 'min-w-0 flex-1 text-xs text-white/80' : 'min-w-0 flex-1 text-[13px]'}>{TEXT[state]}{err && <span className={dark ? 'mt-1 block text-red-300' : 'mt-1 block text-red-700'}>{err}</span>}</p>
      {state === 'off' && (
        <button type="button" disabled={busy} onClick={() => { setBusy(true); setErr(''); void enablePush(tenantId).then((r) => { setState(r.state); if (r.error) setErr(r.error); setBusy(false); }); }}
          className={dark ? 'h-9 shrink-0 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-50' : 'h-9 shrink-0 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-50'}>
          {busy ? 'Turning on…' : 'Turn on notifications'}</button>)}
    </div>
  );
}
