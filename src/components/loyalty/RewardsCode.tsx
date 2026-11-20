'use client';
// src/components/loyalty/RewardsCode.tsx — A MEMBER'S REWARDS CODE on their rewards page (lib/rewards-code; design
// canvas "Rewards at the drive-thru"): six digits they say at the drive-thru's speaker or show at the window, so the
// order is theirs and they can use a reward. A new one every few minutes, fetched again as each one ends.
import * as React from 'react';

const INK = '#16171a', SUB = '#b9bbc0';

export function RewardsCode({ tenantId, clientId, k }: { tenantId: string; clientId: string; k: string }) {
  const [code, setCode] = React.useState<{ code: string; until: string } | null>(null); const [none, setNone] = React.useState(false);
  const [, setTick] = React.useState(0);
  const get = React.useCallback(async () => {
    try {
      const r = await fetch('/api/loyalty/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, clientId, k, action: 'code' }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok && d.code) { setCode({ code: String(d.code), until: String(d.until) }); setNone(false); } else setNone(true);
    } catch { /* tried again shortly */ }
  }, [tenantId, clientId, k]);
  React.useEffect(() => { void get(); }, [get]);
  React.useEffect(() => {
    const i = setInterval(() => { setTick((n) => n + 1); if (code && Date.now() >= Date.parse(code.until)) void get(); }, 1000);
    const vis = () => { if (document.visibilityState === 'visible') void get(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', vis); };
  }, [code, get]);
  if (none) return null;
  const left = code ? Math.max(0, Math.round((Date.parse(code.until) - Date.now()) / 1000)) : 0;
  return (
    <section aria-labelledby="rewards-code" style={{ borderRadius: 20, background: INK, color: '#fff', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p id="rewards-code" style={{ margin: 0, fontSize: 14, color: SUB }}>Your rewards code</p>
      <p style={{ margin: 0, fontSize: 38, fontWeight: 600, letterSpacing: '0.08em', fontVariantNumeric: 'tabular-nums' }} aria-live="polite">{code ? `${code.code.slice(0, 3)} ${code.code.slice(3)}` : ' '}</p>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.45, color: SUB }}>Say it at the drive-thru speaker or show it at the window to earn and use your rewards.{code ? ` A new one in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.` : ''}</p>
    </section>
  );
}
