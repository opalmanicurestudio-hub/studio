'use client';
// src/app/gift/[tenantId]/find/page.tsx — FIND MY GIFT CARD (lib/gift-shop findMyCards). Lost the email or text? Type the
// phone or email it went to; if there are cards for it, one message with a private link to all of them goes to that same
// phone or email. Nothing is shown here, so nobody can look up someone else's cards.
import * as React from 'react';
import { useParams } from 'next/navigation';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', RED = '#b42318', GREEN = '#1f7a4d';
export default function FindGiftCardPage() {
  const tenantId = String(useParams<{ tenantId: string }>()?.tenantId || '');
  const [v, setV] = React.useState(''); const [busy, setBusy] = React.useState(false); const [done, setDone] = React.useState(false); const [err, setErr] = React.useState('');
  const send = async () => { setBusy(true); setErr('');
    const r = await fetch('/api/gift-cards/shop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'find', tenantId, contact: v }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Check your connection and try again.' }));
    setBusy(false); if (r.ok) setDone(true); else setErr(r.error || 'Please try again later.'); };
  return (
    <div className="min-h-dvh px-5 pb-16 pt-16" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif", background: 'radial-gradient(1000px 520px at 0% -10%, #ecebf3 0%, transparent 60%), #f7f7f8' }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" />
      <div className="mx-auto w-full max-w-sm space-y-5">
        <h1 className="text-[30px] font-normal leading-tight tracking-[-0.03em]">Find my gift card</h1>
        {done ? <div className="space-y-3 rounded-[18px] bg-white p-5" style={{ border: `1px solid ${LINE}` }}><p className="flex items-start gap-2 text-[15.5px] leading-relaxed"><span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ background: GREEN }} />If there are gift cards for that {v.includes('@') ? 'email' : 'number'}, we’ve just sent a link to them there.</p>
          <p className="text-[13.5px]" style={{ color: MUTED }}>Nothing came? Try the other one — the card may have been sent to your {v.includes('@') ? 'phone' : 'email'} — or ask the person who gave it to you.</p></div>
          : <>
            <p className="text-[15px] leading-relaxed" style={{ color: MUTED }}>Lost the text or email? Enter the mobile number or email it was sent to and we’ll send it again — with every card you have here.</p>
            <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) send(); }} placeholder="Mobile number or email" aria-label="Mobile number or email" autoComplete="email" className="h-12 w-full rounded-2xl border bg-white px-4 text-[16px] outline-none focus:ring-2 focus:ring-black/10" style={{ borderColor: LINE }} />
            <button type="button" disabled={busy || v.trim().length < 6} onClick={send} className="h-12 w-full rounded-full text-[15.5px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{busy ? 'Sending…' : 'Send me my cards'}</button>
            {err && <p className="text-[14px] font-semibold" style={{ color: RED }} role="alert">{err}</p>}
          </>}
      </div>
    </div>);
}
