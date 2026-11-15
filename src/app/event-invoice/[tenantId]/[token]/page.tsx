'use client';
// src/app/event-invoice/[tenantId]/[token]/page.tsx — THE CLIENT'S FINAL INVOICE (design canvas "Event sheet and final
// invoice"; api/public/event-invoice). Opened from the email: the business, the event, each line, what's been paid and
// what's left, and a button to pay it by card. Back from paying, the payment is confirmed here.
import * as React from 'react';
import { useParams } from 'next/navigation';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
type Inv = { business: string; title: string; date: string; client: string | null; lines: { label: string; cents: number }[]; totalCents: number; paidCents: number; balanceCents: number; paid: boolean; nothing?: boolean; cardOn: boolean };
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayWords = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''; };

async function ask(body: any) {
  try { const r = await fetch('/api/public/event-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return await r.json(); }
  catch { return { ok: false, error: 'No connection. Try again.' }; }
}

export default function EventInvoicePage() {
  const { tenantId, token } = (useParams() || {}) as { tenantId?: string; token?: string };
  const [inv, setInv] = React.useState<Inv | null>(null); const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [confirming, setConfirming] = React.useState(false);

  React.useEffect(() => {
    if (!tenantId || !token) return;
    const sessionId = new URLSearchParams(window.location.search).get('paid');
    let tries = 0; let stop = false;
    const go = async () => {
      const d = await ask({ tenantId, token, ...(sessionId ? { action: 'paid', sessionId } : { action: 'view' }) });
      if (stop) return;
      if (d.ok) { setInv(d.invoice); setConfirming(false); if (sessionId) window.history.replaceState(null, '', window.location.pathname); return; }
      // Still confirming a payment: asked again a few times before saying so.
      if (sessionId && tries++ < 5) { setConfirming(true); setTimeout(go, 2000); return; }
      setErr(d.error || 'This didn’t load. Try again.'); setConfirming(false);
    };
    void go(); return () => { stop = true; };
  }, [tenantId, token]);

  const pay = async () => {
    if (!tenantId || !token) return; setBusy(true); setErr('');
    const d = await ask({ tenantId, token, action: 'pay', expectCents: inv?.balanceCents });
    if (d.ok && d.url) { window.location.assign(d.url); return; }
    setBusy(false); setErr(d.error || 'Checkout didn’t open. Try again.');
    // Changed since it was opened: the latest is shown, to pay from there.
    if (d.code === 'changed') { const v = await ask({ tenantId, token, action: 'view' }); if (v.ok) setInv(v.invoice); }
  };

  return (
    <main className="min-h-screen bg-[#f5f5f7] px-4 py-8" style={{ color: INK, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="mx-auto w-full max-w-[460px] space-y-4">
        {!inv ? (
          <p role={err ? 'alert' : 'status'} className="rounded-2xl bg-[#fff] px-5 py-6 text-[15px]" style={{ color: err ? AMBER : MUTED }}>{err || (confirming ? 'Confirming your payment…' : 'Opening your invoice…')}</p>
        ) : (
          <section className="space-y-4 rounded-2xl border bg-[#fff] p-5 sm:p-6" style={{ borderColor: LINE }} aria-labelledby="inv-title">
            <header>
              {inv.business && <p className="text-[13.5px]" style={{ color: MUTED }}>{inv.business}</p>}
              <h1 id="inv-title" className="text-[22px] font-semibold leading-tight">Your final invoice</h1>
              <p className="text-[14.5px]" style={{ color: MUTED }}>{[inv.title, dayWords(inv.date)].filter(Boolean).join(', ')}</p>
            </header>
            <dl className="space-y-1.5">
              {inv.lines.map((l, i) => <div key={i} className="flex justify-between gap-4 text-[15px]"><dt className="min-w-0">{l.label}</dt><dd className="tabular-nums">{money(l.cents)}</dd></div>)}
              {inv.paidCents > 0 && !inv.paid && <div className="flex justify-between gap-4 text-[15px]"><dt>Paid so far</dt><dd className="tabular-nums">−{money(inv.paidCents)}</dd></div>}
              <div className="flex justify-between gap-4 border-t pt-2 text-[17px] font-semibold" style={{ borderColor: LINE }}><dt>{inv.paid ? 'Paid in full' : 'To pay'}</dt><dd className="tabular-nums">{money(inv.paid ? inv.totalCents : inv.balanceCents)}</dd></div>
            </dl>
            {inv.paid ? (
              <p role="status" className="rounded-xl px-4 py-3 text-[15px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}>Paid. Thank you. Your receipt is on its way by email.</p>
            ) : inv.nothing ? (
              <p className="rounded-xl px-4 py-3 text-[14.5px]" style={{ background: SOFT, color: MUTED }}>There’s nothing to pay on this invoice.</p>
            ) : inv.cardOn ? (<>
              <button type="button" onClick={pay} disabled={busy} className={`min-h-[52px] w-full rounded-2xl text-[16.5px] font-semibold disabled:opacity-60 ${RING}`} style={{ background: INK, color: '#fff' }}>{busy ? 'Opening checkout…' : `Pay ${money(inv.balanceCents)}`}</button>
              <p className="text-center text-[13px]" style={{ color: MUTED }}>By card, on {inv.business || 'the business'}’s own secure checkout. You’ll get a receipt by email.</p>
            </>) : (
              <p className="rounded-xl px-4 py-3 text-[14.5px]" style={{ background: SOFT, color: MUTED }}>Card payment isn’t on right now. {inv.business || 'The business'} will tell you how to pay.</p>
            )}
            {err && <p role="alert" className="rounded-xl px-4 py-3 text-[14px]" style={{ background: AMBER_TINT, color: AMBER }}>{err}</p>}
          </section>
        )}
      </div>
    </main>
  );
}
