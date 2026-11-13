'use client';
// src/components/settings/WalletsCard.tsx — Apple Pay and Google Pay on the business's pay pages (scan to pay at the
// drive-thru, gift cards, deposits, the pay screens): whether they show, and Check again for a manager. They're set up by
// themselves once payments are connected (lib/wallet-domains); this says how it went. api/stripe/wallets.
import { useEffect, useState } from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
type Address = { domain: string; checked: boolean; at: string | null; apple: string; google: string; error: string | null };

async function api(body: any) {
  try {
    const r = await fetch('/api/stripe/wallets', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify(body) });
    return await r.json().catch(() => ({ ok: false, error: 'No answer. Try again.' }));
  } catch { return { ok: false, error: 'No connection. Try again.' }; }
}

function Chip({ on, label }: { on: boolean; label: string }) {
  return <span className="rounded-full px-2.5 py-1 text-[13px] font-medium" style={on ? { background: GREEN_TINT, color: GREEN } : { background: SOFT, color: MUTED }}>{label}: {on ? 'on' : 'not yet'}</span>;
}

export function WalletsCard({ tenantId, canEdit }: { tenantId: string; canEdit: boolean }) {
  const [d, setD] = useState<{ connected: boolean; on: boolean; addresses: Address[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'good' | 'warn' } | null>(null);
  useEffect(() => { if (tenantId) void api({ action: 'status', tenantId }).then((r) => { if (r.ok) setD(r); }); }, [tenantId]);
  if (!d) return null;
  const check = async () => {
    setBusy(true); setMsg(null);
    const r = await api({ action: 'check', tenantId });
    setBusy(false);
    if (!r.ok) { setMsg({ text: r.error || 'That didn’t work. Try again.', tone: 'warn' }); return; }
    setD(r);
    setMsg(r.on ? { text: 'Apple Pay and Google Pay show on your pay pages.', tone: 'good' } : { text: r.error ? `Not on yet: ${r.error}` : 'Not on yet. It’s tried again by itself every few hours.', tone: 'warn' });
  };
  return (
    <div className="space-y-3 rounded-3xl bg-[#fff] p-5" style={{ border: `1px solid ${LINE}`, color: INK }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold">Apple Pay and Google Pay</p>
          <p className="mt-1 text-[14px] leading-relaxed" style={{ color: MUTED }}>Guests can pay with their phone’s wallet on your pay pages: scan to pay, gift cards, deposits and the pay screens. It’s set up by itself once payments are connected.</p>
        </div>
        {d.connected && <span className="shrink-0 rounded-full px-3 py-1.5 text-[14px] font-semibold" style={d.on ? { background: GREEN_TINT, color: GREEN } : { background: AMBER_TINT, color: AMBER }}>{d.on ? 'On' : 'Not on yet'}</span>}
      </div>
      {!d.connected ? <p className="text-[14px]" style={{ color: AMBER }}>Finish setting up payments above first.</p> : (
        <>
          {d.addresses.length === 0 && <p className="text-[14px]" style={{ color: MUTED }}>Your app’s web address isn’t set yet, so there’s nothing to register.</p>}
          <ul className="space-y-2">
            {d.addresses.map((a) => (
              <li key={a.domain} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3" style={{ background: SOFT }}>
                <span className="min-w-0 truncate text-[14px] font-medium">{a.domain}</span>
                {a.checked ? <span className="flex flex-wrap gap-1.5"><Chip on={a.apple === 'active'} label="Apple Pay" /><Chip on={a.google === 'active'} label="Google Pay" /></span>
                  : <span className="text-[13px]" style={{ color: MUTED }}>Not checked yet</span>}
              </li>
            ))}
          </ul>
          {canEdit && <button type="button" onClick={check} disabled={busy} className={`min-h-[44px] rounded-xl px-4 text-[14px] font-semibold disabled:opacity-50 ${RING}`} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK }}>{busy ? 'Checking…' : 'Check again'}</button>}
        </>
      )}
      {msg && <p role="status" className="rounded-2xl px-4 py-3 text-[14px] font-medium" style={msg.tone === 'good' ? { background: GREEN_TINT, color: GREEN } : { background: AMBER_TINT, color: AMBER }}>{msg.text}</p>}
    </div>
  );
}
