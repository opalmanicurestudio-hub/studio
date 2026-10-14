'use client';
// src/components/pos/ReaderPanel.tsx — connect the card reader, in the desk's look.
// Used inside checkout (when no reader is connected yet) and on Settings → Card reader.
// Needs a StripeTerminalProvider above it; without one it explains what's missing.

import { useTerminalOptional, type TerminalReader } from './StripeTerminalProvider';
import { Icon, LiveDot } from '@/components/pos/desk/kit';
import { useState } from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';

const KIND: Record<string, string> = { bbpos_wisepos_e: 'WisePOS E', stripe_s700: 'Stripe S700', bbpos_chipper2x: 'Chipper 2X BT', stripe_m2: 'Stripe M2', verifone_P400: 'Verifone P400', simulated_wisepos_e: 'Test reader' };

export function ReaderPanel({ compact, onReady, tenantId, manager }: { compact?: boolean; onReady?: () => void; tenantId?: string | null; manager?: boolean }) {
  const t = useTerminalOptional();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [looked, setLooked] = useState(false);
  const [adding, setAdding] = useState(false); const [code, setCode] = useState(''); const [label, setLabel] = useState('Front desk'); const [addMsg, setAddMsg] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  if (!t) return <p className="text-[14px]" style={{ color: 'var(--muted)' }}>The card reader connects from the front desk.</p>;
  const { isLoaded, setupError, isDiscovering, readerStatus, connectedReader, discoveredReaders, discoverReaders, connectReader, disconnectReader } = t;
  const connected = readerStatus === 'connected' || readerStatus === 'busy';
  const look = async () => { setLooked(true); await discoverReaders(); };
  const connect = async (r: TerminalReader) => { setBusyId(r.id); const ok = await connectReader(r); setBusyId(null); if (ok) onReady?.(); };
  const row = 'flex w-full items-center gap-3 rounded-2xl p-3.5 text-left';

  return (
    <div className="space-y-3">
      <div className={row} style={{ border: '1px solid var(--line)', background: 'var(--card)' }}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: connected ? 'color-mix(in srgb, var(--ok) 14%, transparent)' : 'var(--soft)', color: connected ? 'var(--ok)' : 'var(--muted)' }}><Icon name="card" size={19} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[15px] font-semibold">{connected ? connectedReader?.label || 'Card reader' : readerStatus === 'connecting' ? 'Connecting…' : 'No reader connected'}{connected && <LiveDot />}</span>
          <span className="block text-[13px]" style={{ color: 'var(--muted)' }}>
            {connected ? `${KIND[connectedReader?.deviceType || ''] || connectedReader?.deviceType || 'Reader'} · ready for tap, insert or swipe`
              : !isLoaded && !setupError ? 'Starting the reader connection…'
              : 'Turn the reader on and keep it on the same Wi‑Fi as this device.'}
          </span>
        </span>
        {connected && !compact && <button type="button" onClick={() => void disconnectReader()} className="h-9 shrink-0 rounded-full px-3.5 text-[13px] font-semibold" style={{ background: 'var(--soft)' }}>Disconnect</button>}
      </div>

      {setupError && <p className="flex items-start gap-2 rounded-2xl p-3.5 text-[13.5px]" style={{ background: 'color-mix(in srgb, var(--warn) 9%, transparent)', color: 'var(--ink)' }}><Icon name="alert" size={16} className="mt-0.5" style={{ color: 'var(--warn)' }} />{setupError}</p>}

      {!connected && <>
        <button type="button" onClick={look} disabled={!isLoaded || isDiscovering} className="flex h-11 w-full items-center justify-center gap-2 rounded-full text-[14px] font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
          <Icon name="search" size={17} />{isDiscovering ? 'Looking for readers…' : looked ? 'Look again' : 'Find readers'}</button>
        {isDiscovering && <div className="d-shimmer h-1 rounded-full" aria-hidden />}
        {discoveredReaders.length > 0 && <div className="space-y-2">{discoveredReaders.map((r) => (
          <button key={r.id} type="button" onClick={() => void connect(r)} disabled={!!busyId} className={`${row} d-row d-rise disabled:opacity-60`} style={{ border: '1px solid var(--line)' }}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--soft)' }}><Icon name="card" size={17} /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] font-semibold">{r.label}</span><span className="block truncate text-[12.5px]" style={{ color: 'var(--muted)' }}>{KIND[r.deviceType] || r.deviceType}{r.serialNumber ? ` · ${r.serialNumber}` : ''}{r.status === 'offline' ? ' · offline' : ''}</span></span>
            <span className="text-[13px] font-semibold">{busyId === r.id ? 'Connecting…' : 'Connect'}</span>
          </button>))}</div>}
        {looked && !isDiscovering && discoveredReaders.length === 0 && !setupError && <p className="text-[13px]" style={{ color: 'var(--muted)' }}>No readers found. Check the reader is on, charged and on the same network. A new reader needs adding once, below.</p>}
        {manager && tenantId && (!adding ? <button type="button" onClick={() => { setAdding(true); setAddMsg(null); }} className="flex items-center gap-1.5 text-[13.5px] font-semibold underline underline-offset-4"><Icon name="plus" size={15} />Add a new reader</button>
          : <section aria-label="Add a new reader" className="d-rise space-y-2.5 rounded-2xl p-4" style={{ background: 'var(--soft)' }}>
            <p className="text-[14px] font-semibold">Add a new reader</p>
            <p className="text-[13px]" style={{ color: 'var(--muted)' }}>On the reader, open its settings and choose to generate a pairing code. Type the code it shows.</p>
            <input value={code} onChange={(ev) => setCode(ev.target.value)} placeholder="e.g. sepia-cerulean-aqua" aria-label="Code on the reader" autoCapitalize="none" autoCorrect="off" className="h-11 w-full rounded-xl px-3.5 text-[15px] outline-none" style={{ background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
            <input value={label} onChange={(ev) => setLabel(ev.target.value)} placeholder="Name, e.g. Front desk" aria-label="Reader name" className="h-11 w-full rounded-xl px-3.5 text-[15px] outline-none" style={{ background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
            {addMsg && <p className="text-[13px]" style={{ color: addMsg.startsWith('Added') ? 'var(--ok)' : 'var(--warn)' }}>{addMsg}</p>}
            <div className="flex gap-2">
              <button type="button" disabled={!code.trim() || saving} onClick={async () => { setSaving(true); setAddMsg(null);
                const r = await fetch('/api/stripe/terminal/register-reader', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, code, label }) }).then((x) => x.json()).catch(() => ({ ok: false }));
                setSaving(false);
                if (r.ok) { setAddMsg(`Added ${r.label}. Finding it now…`); setCode(''); const found = await discoverReaders(); const m = found.find((x) => x.id === r.id); if (m) { setAddMsg(`Added ${r.label}.`); await connect(m); setAdding(false); } }
                else setAddMsg(r.error || 'The reader couldn’t be added.'); }}
                className="h-11 flex-1 rounded-full text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{saving ? 'Adding…' : 'Add and connect'}</button>
              <button type="button" onClick={() => setAdding(false)} className="h-11 rounded-full px-4 text-[14px]" style={{ background: 'var(--card)' }}>Cancel</button>
            </div>
          </section>)}
      </>}
    </div>
  );
}
