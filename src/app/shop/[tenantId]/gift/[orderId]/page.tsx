'use client';
// /shop/[tenantId]/gift/[orderId]?g=<gift code> — GIFT EXCHANGE for the person who received a gift. Only the items:
// no prices, no sender details. They pick what to exchange, add their name and email, and get shop credit in their
// own name once it's back. The person who sent the gift isn't told.
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';

type Item = { lineId: string; name: string; qty: number; finalSale: boolean; finalSaleNote: string };
const REASONS: [string, string][] = [['changed_mind', 'Not quite right for me'], ['wrong_item', 'Not what the card said'], ['damaged_in_transit', 'Arrived damaged'], ['defective', 'Doesn’t work'], ['other', 'Something else']];
const ink = '#16171a', muted = '#6d7075', line = '#ececee', soft = '#f5f5f7', green = '#1f7a4d', amber = '#b45309';

export default function GiftExchangePage() {
  const { tenantId, orderId } = useParams() as { tenantId: string; orderId: string };
  const g = useSearchParams().get('g') || '';
  const [info, setInfo] = React.useState<any>(null);
  const [err, setErr] = React.useState('');
  const [pick, setPick] = React.useState<Record<string, number>>({});
  const [reason, setReason] = React.useState('changed_mind');
  const [name, setName] = React.useState(''); const [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [done, setDone] = React.useState<{ message: string; label?: string } | null>(null);

  React.useEffect(() => {
    fetch(`/api/retail/gift?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}&g=${encodeURIComponent(g)}`)
      .then((r) => r.json()).then((d) => { if (d.ok) setInfo(d); else setErr(d.error || 'We couldn’t open this gift.'); })
      .catch(() => setErr('We couldn’t open this gift. Check your connection and try again.'));
  }, [tenantId, orderId, g]);

  const chosen = Object.entries(pick).filter(([, q]) => q > 0);
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/retail/gift', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, orderId, g, name, email, selections: chosen.map(([lineId, qty]) => ({ lineId, qty, reason })) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || 'That didn’t go through. Try again.'); return; }
      let label = '';
      if (d.shipped) {
        const l = await fetch('/api/retail/return-label', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, orderId, returnId: d.returnId, giftToken: g }) }).then((x) => x.json()).catch(() => ({}));
        label = l?.labelUrl || '';
      }
      setDone({ message: d.message, label });
    } finally { setBusy(false); }
  };

  return (
    <main style={{ minHeight: '100dvh', background: '#fff', color: ink, fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif" }}>
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '40px 16px 64px' }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: muted }}>{info?.shopName || 'Gift exchange'}</p>
        <h1 style={{ margin: '6px 0 0', fontSize: 34, fontWeight: 300, letterSpacing: '-0.02em' }}>{info?.to ? `A gift for ${info.to}` : 'Your gift'}</h1>
        <p style={{ margin: '8px 0 0', fontSize: 16, color: muted, lineHeight: 1.5 }}>Not quite right? Send it back for shop credit in your own name, to spend on whatever you like. The person who sent it isn’t told.</p>

        {err && <p role="alert" style={{ marginTop: 20, padding: '12px 16px', borderRadius: 16, background: '#fdf3e7', color: amber, fontWeight: 600 }}>{err}</p>}
        {!info && !err && <p style={{ marginTop: 24, color: muted }}>Opening your gift…</p>}

        {done ? (
          <section style={{ marginTop: 24, padding: 20, borderRadius: 20, background: soft }}>
            <p style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>{done.message}</p>
            <p style={{ margin: '8px 0 0', color: muted, lineHeight: 1.5 }}>Once it’s back and checked, your credit goes to {email}. Use it by signing in with that email at checkout.</p>
            {done.label && <a href={done.label} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', height: 48, marginTop: 16, padding: '0 20px', borderRadius: 999, background: ink, color: '#fff', fontWeight: 600, textDecoration: 'none' }}>Open the return label</a>}
          </section>
        ) : info && !info.window.open ? (
          <p style={{ marginTop: 24, padding: 16, borderRadius: 16, background: soft, fontWeight: 600 }}>{info.window.reason}</p>
        ) : info ? (
          <>
            <section style={{ marginTop: 28 }}>
              <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: muted }}>What would you like to exchange?</p>
              <div style={{ border: `1px solid ${line}`, borderRadius: 16, overflow: 'hidden' }}>
                {info.items.map((it: Item, i: number) => (
                  <div key={it.lineId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', minHeight: 56, borderTop: i ? `1px solid ${line}` : undefined }}>
                    <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontWeight: 600 }}>{it.name}</span>{it.finalSale ? <span style={{ display: 'block', fontSize: 13, color: muted }}>Final sale. Can only come back if it arrived damaged or faulty.</span> : null}</span>
                    {it.qty > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button type="button" aria-label={`One fewer ${it.name}`} onClick={() => setPick((p) => ({ ...p, [it.lineId]: Math.max(0, (p[it.lineId] || 0) - 1) }))} style={{ width: 44, height: 44, borderRadius: 22, border: 'none', background: soft, fontSize: 20 }}>−</button>
                        <span style={{ width: 20, textAlign: 'center', fontWeight: 600 }}>{pick[it.lineId] || 0}</span>
                        <button type="button" aria-label={`One more ${it.name}`} onClick={() => setPick((p) => ({ ...p, [it.lineId]: Math.min(it.qty, (p[it.lineId] || 0) + 1) }))} style={{ width: 44, height: 44, borderRadius: 22, border: 'none', background: soft, fontSize: 20 }}>+</button>
                      </span>)}
                  </div>))}
              </div>
            </section>
            <section style={{ marginTop: 20, display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: muted }}>Why
                <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ height: 48, borderRadius: 12, border: `1px solid ${line}`, padding: '0 12px', fontSize: 16, color: ink, background: '#fff' }}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: muted }}>Your name
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" style={{ height: 48, borderRadius: 12, border: `1px solid ${line}`, padding: '0 12px', fontSize: 16, color: ink }} />
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600, color: muted }}>Your email, for your credit
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" style={{ height: 48, borderRadius: 12, border: `1px solid ${line}`, padding: '0 12px', fontSize: 16, color: ink }} />
              </label>
              <p style={{ margin: 0, fontSize: 13, color: muted }}>Exchanges are open for {info.window.days} days after delivery.{info.shipped ? ' A prepaid return label comes right after you send this.' : ' Bring the items to the shop to finish.'}</p>
              <button type="button" disabled={busy || !chosen.length || !name.trim() || !email.trim()} onClick={() => void submit()} style={{ height: 52, borderRadius: 999, border: 'none', background: ink, color: '#fff', fontSize: 17, fontWeight: 600, opacity: busy || !chosen.length || !name.trim() || !email.trim() ? 0.45 : 1 }}>{busy ? 'Sending…' : 'Exchange for shop credit'}</button>
            </section>
          </>
        ) : null}
      </div>
    </main>);
}
