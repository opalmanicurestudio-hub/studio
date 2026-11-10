'use client';
// src/components/rent/RenterCard.tsx — THE RENTER'S CARD ON FILE AND AUTOPAY, in their portal's Rent tab.
// Save a card (or change it) on the business's own secure card page (api/booths/setup-card, signed in with the portal
// session), then turn autopay on or off. Autopay reads as on only when the business can actually charge the card
// (rentOutlook.autopayOn); a card saved before the business's payments moved has to be saved again first. Turning it on
// asks for their written OK first: the authorization's words, signed by typing their name, kept and emailed to them.
import * as React from 'react';
import { CreditCard } from 'lucide-react';
import { api } from '@/components/rent/studio';

const brandName = (b: any) => { const s = String(b || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Card'; };

export function RenterCard({ tenantId, token, renter, autopayOn, hasLease, waitingSignature = false, onChanged, onToast }: {
  tenantId: string; token: string; renter: any; autopayOn: boolean; hasLease: boolean; waitingSignature?: boolean;
  onChanged: () => void; onToast: (t: { title: string; description?: string; bad?: boolean }) => void;
}) {
  const [busy, setBusy] = React.useState<'' | 'card' | 'autopay'>('');
  const [auth, setAuth] = React.useState<{ text: string; sha: string } | null>(null);
  const [authName, setAuthName] = React.useState('');
  const usable = renter?.cardUsable === true;
  const stale = !usable && renter?.cardOnFile === true;
  const wantsAutopay = renter?.autopayEnabled === true;
  const card = `${brandName(renter?.cardBrand)} ending ${renter?.cardLast4 || '····'}`;

  const saveCard = async () => {
    setBusy('card');
    try {
      const r = await fetch('/api/booths/setup-card', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, renterId: renter.id, portalToken: token, returnUrl: `${window.location.origin}/rent/${encodeURIComponent(tenantId)}` }) });
      const j: any = await r.json().catch(() => ({}));
      if (j?.ok && j.url) { window.location.assign(j.url); return; }
      onToast({ title: 'The card page didn’t open', description: j?.error || 'Try again in a moment.', bad: true });
    } catch { onToast({ title: 'The card page didn’t open', description: 'Try again in a moment.', bad: true }); }
    setBusy('');
  };
  const askAutopay = async () => {
    setBusy('autopay');
    const d = await api({ action: 'autopay-terms', tenantId, token });
    setBusy('');
    if (!d?.ok || !d.text) { onToast({ title: 'Autopay can’t be turned on yet', description: d?.error || 'Try again in a moment.', bad: true }); return; }
    setAuth({ text: d.text, sha: d.sha }); setAuthName('');
  };
  const setAutopay = async (enabled: boolean) => {
    setBusy('autopay');
    const d = await api({ action: 'autopay-set', tenantId, token, enabled, ...(enabled && auth ? { signedName: authName, shownSha: auth.sha } : {}) });
    setBusy('');
    if (!d?.ok) { onToast({ title: 'Autopay didn’t change', description: d?.error || 'Try again in a moment.', bad: true }); if (enabled) setAuth(null); return; }
    setAuth(null);
    onToast({ title: enabled ? 'Autopay is on' : 'Autopay is off', description: enabled ? 'Your rent is taken from your card on each due date. A copy of what you signed is on its way to your email.' : 'You’ll pay each rent bill yourself.' });
    onChanged();
  };

  const cardLine = usable ? `${card} is saved for your rent and agreed charges.`
    : stale ? `Your ${card} was saved before the business changed how it takes payments. Please save it again.`
    : 'No card saved yet.';
  const autopayLine = !hasLease ? ''
    : waitingSignature ? (wantsAutopay ? 'On. It starts taking rent once you sign your lease.' : 'Your lease starts once you sign it. You can turn autopay on now or later.')
    : autopayOn ? `On. Your rent is taken from your ${card} on each due date.`
    : wantsAutopay ? 'On, but it can’t take rent until your card is saved again.'
    : usable ? 'Off. You pay each rent bill yourself.'
    : 'Save a card to turn on autopay.';

  return (
    <section className="space-y-3">
      <div className="rounded-2xl border border-[#ececee] bg-white p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f5f5f7]"><CreditCard className="h-5 w-5 text-[#16171a]" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-[#16171a]">Card on file</p>
            <p className={`mt-0.5 text-[13.5px] ${stale ? 'text-[#b45309]' : 'text-[#6d7075]'}`}>{cardLine}</p>
          </div>
        </div>
        <button type="button" onClick={saveCard} disabled={!!busy}
          className="mt-3 h-11 w-full rounded-xl border border-[#ececee] bg-white text-[14px] font-medium text-[#16171a] disabled:opacity-50">
          {busy === 'card' ? 'Opening…' : usable ? 'Change card' : 'Save a card'}
        </button>
        {hasLease && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#ececee] pt-4">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-[#16171a]">Autopay</p>
              <p className={`mt-0.5 text-[13.5px] ${wantsAutopay && !autopayOn && !waitingSignature ? 'text-[#b45309]' : 'text-[#6d7075]'}`}>{autopayLine}</p>
            </div>
            <button type="button" role="switch" aria-checked={wantsAutopay} aria-label="Autopay" disabled={!!busy || (!wantsAutopay && !usable)}
              onClick={() => (wantsAutopay ? setAutopay(false) : askAutopay())}
              className="grid h-11 w-16 shrink-0 place-items-center disabled:opacity-40">
              <span className={`relative block h-8 w-14 rounded-full transition-colors ${wantsAutopay ? 'bg-[#1f7a4d]' : 'bg-[#d9d9de]'}`}>
                <span className={`absolute top-1 h-6 w-6 rounded-full bg-[#ffffff] shadow transition-all ${wantsAutopay ? 'left-7' : 'left-1'}`} />
              </span>
            </button>
          </div>
        )}
        {auth && !wantsAutopay && (
          <div className="mt-3 space-y-2 rounded-2xl bg-[#f5f5f7] p-3.5" role="group" aria-label="Autopay authorization">
            <p className="text-[14px] font-semibold text-[#16171a]">Your OK for autopay</p>
            <p className="text-[13.5px] leading-relaxed text-[#16171a]">{auth.text}</p>
            <input autoFocus value={authName} onChange={(e) => setAuthName(e.target.value.slice(0, 120))} aria-label="Type your full name to authorize autopay" placeholder="Type your full name" autoComplete="name"
              className="h-11 w-full rounded-xl border border-[#ececee] bg-white px-3 text-[14px]" />
            <p className="text-[12.5px] text-[#6d7075]">Typing your name and turning it on is your signature. It’s kept with these exact words, and a copy goes to your email.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAutopay(true)} disabled={!!busy || authName.trim().length < 2} className="h-11 flex-1 rounded-xl bg-[#16171a] text-[14px] font-medium text-white disabled:opacity-40">{busy === 'autopay' ? 'Turning on…' : 'Turn on autopay'}</button>
              <button type="button" onClick={() => setAuth(null)} className="h-11 rounded-xl border border-[#ececee] bg-white px-4 text-[14px] font-medium text-[#16171a]">Not now</button>
            </div>
          </div>
        )}
        <p className="mt-3 text-[12.5px] text-[#6d7075]">Your card is kept by the business’s secure payment provider; this page never sees the number.</p>
      </div>
    </section>
  );
}
