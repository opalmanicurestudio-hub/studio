'use client';
// src/app/global-error.tsx — the last line of defence when the app's outer frame itself fails: an outdated copy reloads
// once; anything else is reported and gets a plain Reload screen with the error's words.
import * as React from 'react';
import { isStaleCopy, reloadOnce, reportCrash } from '@/lib/client-crash';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  React.useEffect(() => { if (isStaleCopy(error) && reloadOnce()) return; reportCrash(error, 'global', { digest: error?.digest }); }, [error]);
  return (
    <html lang="en"><body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', color: '#16171a', background: '#fff' }}>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, textAlign: 'center' }}>
        <p style={{ fontSize: 24, margin: 0 }}>Something went wrong</p>
        <p style={{ fontSize: 15, color: '#6d7075', margin: 0, maxWidth: 360 }}>Reloading usually fixes it. The details have been sent so it can be fixed.</p>
        <button type="button" onClick={() => window.location.reload()} style={{ height: 48, borderRadius: 24, padding: '0 24px', border: 0, background: '#16171a', color: '#fff', fontSize: 15, fontWeight: 600 }}>Reload</button>
        <p style={{ fontSize: 12, color: '#9a9ca1', maxWidth: 420, wordBreak: 'break-word' }}>{String(error?.message || '').slice(0, 300)}{error?.digest ? ` (ref ${error.digest})` : ''}</p>
      </div>
    </body></html>);
}
