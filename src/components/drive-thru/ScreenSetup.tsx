'use client';
// src/components/drive-thru/ScreenSetup.tsx — SETTING UP A DRIVE-THRU SCREEN (the lane tablet, the order board by the
// speaker, or the screen facing the guest at the window): a manager signed in on it does it once (api/kitchen 'pair',
// kind 'drive-thru', or 'drive-thru-board' for a screen guests see, whose key can only show), and from then on the
// screen carries its own key and keeps working when they sign out.
import { useState } from 'react';
import { Car } from 'lucide-react';
import { useFirebase } from '@/firebase';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] px-4 rounded-xl text-[15px] font-semibold disabled:opacity-50 transition-colors ${RING}`;

export function ScreenSetup({ tenantId, stopped, onPaired, board = false, window: atWindow = false, menu = false }: { tenantId: string; stopped: string; onPaired: (key: string) => void; board?: boolean; window?: boolean; menu?: boolean }) {
  const { user, isUserLoading } = useFirebase() as any;
  const shows = board || atWindow || menu;
  const [name, setName] = useState(menu ? 'Menu board' : atWindow ? 'Window screen' : board ? 'Order board' : 'Drive-thru window'); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const pair = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/kitchen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pair', tenantId, name, kind: shows ? 'drive-thru-board' : 'drive-thru' }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok && d.key) onPaired(String(d.key)); else setErr(d.error || 'That didn’t go through. Try again.');
    } catch { setErr('No connection. Try again.'); }
    setBusy(false);
  };
  const next = typeof window !== 'undefined' ? window.location.pathname : `/drive-thru/${tenantId}`;
  return (
    <main className="flex min-h-dvh items-center justify-center p-4" style={{ background: SOFT, color: INK }}>
      <div className="w-full max-w-md space-y-4 rounded-3xl bg-[#fff] p-6" style={{ border: `1px solid ${LINE}` }}>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: INK, color: '#fff' }}><Car className="h-6 w-6" aria-hidden /></div>
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">{menu ? 'Set up the menu board' : atWindow ? 'Set up the window screen' : board ? 'Set up the order board' : 'Set up the drive-thru screen'}</h1>
          <p className="mt-1.5 text-[15px] leading-relaxed" style={{ color: MUTED }}>{menu
            ? 'A manager sets this screen up once. It shows the menu with photos and prices, and what’s sold out, as it changes. Nothing else.'
            : atWindow
            ? 'A manager sets this screen up once. It faces the guest at the window: their order, the total, how paying is going, and where to go next. Nothing else.'
            : board
            ? 'A manager sets this screen up once. It shows each guest their order as it’s taken at the speaker, and nothing else.'
            : 'A manager sets this tablet up once. After that it keeps working when they sign out: anyone at the speaker or the window can take orders and payments, and a PIN only puts a name on what they did.'}</p>
        </div>
        {stopped && <div className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{stopped}</div>}
        {isUserLoading ? <div className="mx-auto h-7 w-7 animate-spin rounded-full border-[3px]" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading" />
          : user ? (
            <div className="space-y-3">
              <label className="block"><span className="text-[14px] font-medium">Name this screen</span>
                <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} className="mt-1.5 min-h-[44px] w-full rounded-xl px-3 text-[16px] outline-none focus:border-[#16171a]" style={{ border: `1px solid ${LINE}` }} placeholder={menu ? 'Menu board' : atWindow ? 'Pay window' : board ? 'Order board' : 'Speaker, Window'} /></label>
              {err && <p role="alert" className="text-[14px]" style={{ color: AMBER }}>{err}</p>}
              <button type="button" onClick={pair} disabled={busy} className={`${btn} w-full`} style={{ background: INK, color: '#fff' }}>{busy ? 'Setting up…' : 'Set up this screen'}</button>
              <p className="text-[13px]" style={{ color: MUTED }}>Signed in as {user.email || 'you'}. Only an owner or manager can set up a screen.</p>
            </div>
          ) : <a href={`/login?next=${encodeURIComponent(next)}`} className={`${btn} inline-flex w-full items-center justify-center`} style={{ background: INK, color: '#fff' }}>Sign in to set it up</a>}
      </div>
    </main>
  );
}
