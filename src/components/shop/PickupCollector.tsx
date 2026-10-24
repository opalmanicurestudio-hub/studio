'use client';
// src/components/shop/PickupCollector.tsx — ON THE ORDER PAGE, UNDER THE PICKUP QR CODE: the 4-digit code to say at the
// counter or the car (lib/pickup-pass), and who's collecting it. "Someone else" takes a name; the team sees it on their
// screens, and anyone named collects it with the same code. Saved on the server (api/retail/self-serve, action
// 'collector'), which needs the customer's pass as any change to their order does.
import * as React from 'react';

const ink = '#16171a'; const muted = '#6d7075'; const line = '#ececee'; const soft = '#f5f5f7'; const green = '#1f7a4d';

export function PickupCollector({ pin, collector, canChange, onSave }: {
  pin: string | null; collector: string | null; canChange: boolean;
  onSave: (name: string) => Promise<void>;
}) {
  const [who, setWho] = React.useState<'me' | 'other'>(collector ? 'other' : 'me');
  const [name, setName] = React.useState(collector || '');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [saved, setSaved] = React.useState<string | null>(null);
  React.useEffect(() => { setWho(collector ? 'other' : 'me'); setName(collector || ''); }, [collector]);
  const save = async (next: string) => {
    setBusy(true); setErr(''); setSaved(null);
    try { await onSave(next); setSaved(next); } catch (e: any) { setErr(e?.message || 'That didn’t save. Try again.'); } finally { setBusy(false); }
  };
  const pick = (w: 'me' | 'other') => { setWho(w); setSaved(null); if (w === 'me' && collector) void save(''); };
  const seg = (on: boolean): React.CSSProperties => ({ background: on ? '#fff' : 'transparent', color: on ? ink : muted, boxShadow: on ? '0 1px 2px rgba(22,23,26,.08)' : 'none' });
  return (
    <div className="space-y-4 text-left">
      {pin && (
        <div className="rounded-2xl p-4 text-center" style={{ background: soft }}>
          <p className="m-0 text-[13px]" style={{ color: muted }}>Pickup code</p>
          <p className="m-0 mt-1 text-[32px] font-semibold tabular-nums" style={{ color: ink, letterSpacing: '0.3em', paddingLeft: '0.3em' }} aria-label={`Pickup code ${pin.split('').join(' ')}`}>{pin}</p>
          <p className="m-0 mt-1 text-[13px]" style={{ color: muted }}>Say this code if the QR code won’t scan.</p>
        </div>
      )}
      {!canChange && collector && <p className="m-0 text-[15px]" style={{ color: ink }}>{collector} is collecting it.</p>}
      {canChange && (
        <div className="space-y-2">
          <p className="m-0 text-[15px] font-semibold" style={{ color: ink }}>Who’s collecting?</p>
          <div className="grid grid-cols-2 gap-1 rounded-full p-1" style={{ background: soft }} role="group" aria-label="Who’s collecting">
            <button type="button" aria-pressed={who === 'me'} disabled={busy} onClick={() => pick('me')} className="h-10 rounded-full text-[15px] font-medium" style={seg(who === 'me')}>Me</button>
            <button type="button" aria-pressed={who === 'other'} disabled={busy} onClick={() => pick('other')} className="h-10 rounded-full text-[15px] font-medium" style={seg(who === 'other')}>Someone else</button>
          </div>
          {who === 'other' && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void save(name.trim()); }}>
              <input value={name} onChange={(e) => { setName(e.target.value); setSaved(null); }} maxLength={60} placeholder="Their name" aria-label="Their name" autoComplete="off"
                className="h-12 min-w-0 flex-1 rounded-xl px-4 text-[16px] outline-none" style={{ border: `1px solid ${line}`, color: ink, background: '#fff' }} />
              <button type="submit" disabled={busy || !name.trim() || name.trim() === (collector || '')} className="h-12 shrink-0 rounded-full px-5 text-[15px] font-semibold disabled:opacity-40" style={{ background: ink, color: '#fff' }}>{busy ? 'Saving…' : 'Save'}</button>
            </form>
          )}
          <p className="m-0 text-[13px]" style={{ color: err ? '#b45309' : saved ? green : muted }} role={err ? 'alert' : 'status'}>
            {err || (saved !== null ? (saved ? `Saved. The team knows ${saved} is collecting it.` : 'Saved. You’re collecting it.') : who === 'other' ? 'Anyone you name can collect it with your code.' : 'Bring the QR code or the pickup code.')}
          </p>
        </div>
      )}
    </div>
  );
}
