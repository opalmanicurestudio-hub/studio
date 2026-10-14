'use client';
// src/app/(app)/error.tsx — if a screen in the main app (front desk, planner, staff, …) breaks. An outdated copy after
// an update (a tablet that kept the app open overnight asks for files that no longer exist) reloads itself once —
// that's the usual cause of "it crashed after an update" and a reload fixes it. Anything else is reported
// (/api/client-error) and shows a plain screen with the error's own words, so it can be sent on and fixed.
import * as React from 'react';
import { isStaleCopy, reloadOnce, reportCrash } from '@/lib/client-crash';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => { if (isStaleCopy(error) && reloadOnce()) return; reportCrash(error, 'app-route', { digest: error?.digest }); }, [error]);
  // Where it broke: the first few places in the code, without the long file addresses — enough to find the line.
  const where = String(error?.stack || '').split('\n').map((l) => l.trim().replace(/\(?https?:\/\/[^/]+\/_next\/static\/chunks\//, '(').replace(/\?[^:)]*/, '')).filter((l) => l && !/^Error|^\w*Error:/.test(l)).slice(0, 4).join(' | ');
  const details = `${String(error?.message || 'Unknown error').slice(0, 300)}${error?.digest ? ` (ref ${error.digest})` : ''} — ${typeof window !== 'undefined' ? window.location.pathname : ''}${where ? ` — at ${where.slice(0, 400)}` : ''}`;
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-8 text-center" style={{ color: '#16171a' }}>
      <p className="text-[24px] font-light tracking-[-0.02em]">This screen didn’t load</p>
      <p className="max-w-sm text-[15px]" style={{ color: '#6d7075' }}>Reloading usually fixes it. The details have been sent so it can be fixed for good.</p>
      <button type="button" onClick={() => window.location.reload()} className="h-12 rounded-full px-6 text-[15px] font-semibold text-white" style={{ background: '#16171a' }}>Reload</button>
      <button type="button" onClick={reset} className="text-[14px] font-semibold" style={{ color: '#6d7075' }}>Try again without reloading</button>
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(details); setCopied(true); } catch { /* shown below anyway */ } }} className="max-w-md break-words rounded-2xl border px-4 py-3 text-left text-[12.5px]" style={{ borderColor: '#ececee', color: '#6d7075' }}>
        <b style={{ color: '#16171a' }}>{copied ? 'Copied' : 'Tap to copy the details'}</b><br />{details}</button>
    </div>);
}
