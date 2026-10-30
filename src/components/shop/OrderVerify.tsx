'use client';
// src/components/shop/OrderVerify.tsx — "CONFIRM IT'S YOU" on an order page (api/retail/order-pass, lib/order-pass). A
// 6-digit code goes to the email or mobile already on the order; the right code gives this device a pass for 30 days,
// so the page shows the full address and email and lets them change their details. Shown as a sheet when they try to
// change something, and as the whole page when the order's link has expired.
import * as React from 'react';

type Verify = { emailMasked?: string | null; phoneEnding?: string | null; canText?: boolean } | null;

const ink = '#16171a'; const muted = '#6d7075'; const line = '#ececee'; const soft = '#f5f5f7'; const warn = '#b45309';
const btn: React.CSSProperties = { height: 48, borderRadius: 999, border: 0, fontSize: 15, fontWeight: 600, padding: '0 20px', cursor: 'pointer', fontFamily: 'inherit' };

export function OrderVerify({ tenantId, orderId, verify, expired, gift, shopName, orderNumber, onPass, onClose }: {
  tenantId: string; orderId: string; verify: Verify; expired?: boolean; gift?: boolean; shopName?: string; orderNumber?: number | string | null;
  onPass: (pass: string) => void; onClose?: () => void;
}) {
  const [sentTo, setSentTo] = React.useState(''); const [vid, setVid] = React.useState('');
  const [code, setCode] = React.useState(''); const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState('');
  const ask = async (via: 'email' | 'phone') => {
    setBusy(via); setErr('');
    try {
      const r = await fetch('/api/retail/order-pass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, orderId, action: 'send', via }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || 'That didn’t go through. Try again in a moment.'); return; }
      setVid(String(d.verificationId || '')); setSentTo(String(d.sentTo || '')); setCode('');
    } catch { setErr('That didn’t go through. Check your connection and try again.'); } finally { setBusy(''); }
  };
  const confirm = async () => {
    if (code.replace(/\D/g, '').length !== 6) { setErr('Enter the 6-digit code.'); return; }
    setBusy('confirm'); setErr('');
    try {
      const r = await fetch('/api/retail/order-pass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, orderId, action: 'confirm', verificationId: vid, code: code.replace(/\D/g, '') }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.pass) { setErr(d.error || 'That code didn’t work. Try again.'); return; }
      onPass(String(d.pass));
    } catch { setErr('That didn’t go through. Check your connection and try again.'); } finally { setBusy(''); }
  };
  const num = orderNumber != null && orderNumber !== '' ? `#${String(orderNumber).padStart(4, '0')}` : '';
  const body = (
    <div style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: ink, width: '100%', maxWidth: 420 }}>
      {shopName ? <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: muted }}>{shopName}</p> : null}
      <h1 style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{expired && !gift ? <>This link has <b style={{ fontWeight: 600 }}>expired</b></> : <>Confirm it’s <b style={{ fontWeight: 600 }}>you</b></>}</h1>
      <p style={{ margin: '8px 0 0', fontSize: 15, color: muted, lineHeight: 1.5 }}>
        {gift
          ? 'This order was a gift, so it stays private. If you bought it, we’ll send a code to the email or mobile on it. If it was a gift for you, open it from the button in your gift email.'
          : expired
          ? `Order links stay open while an order can still be returned or reported. To see order ${num || 'this order'} again, we’ll send a code to the email or mobile on it.`
          : 'To see your full address and change your details, we’ll send a code to the email or mobile on this order. This device stays confirmed for 30 days.'}
      </p>
      {!vid ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 18 }}>
          {verify?.emailMasked ? <button type="button" disabled={!!busy} onClick={() => void ask('email')} style={{ ...btn, background: ink, color: '#fff' }}>{busy === 'email' ? 'Sending…' : `Email a code to ${verify.emailMasked}`}</button> : null}
          {verify?.canText && verify.phoneEnding ? <button type="button" disabled={!!busy} onClick={() => void ask('phone')} style={{ ...btn, background: soft, color: ink }}>{busy === 'phone' ? 'Sending…' : `Text a code to the number ending in ${verify.phoneEnding}`}</button> : null}
          {!verify?.emailMasked && !(verify?.canText && verify?.phoneEnding) ? <p style={{ margin: 0, fontSize: 14, color: muted }}>There’s no email or mobile on this order to send a code to. Send the shop a message from the order page, or reply to one of their emails.</p> : null}
        </div>
      ) : (
        <div style={{ marginTop: 18 }}>
          <p style={{ margin: 0, fontSize: 14, color: muted }}>We sent a 6-digit code to {sentTo}. It expires in 10 minutes.</p>
          <label style={{ display: 'block', marginTop: 10, fontSize: 13, fontWeight: 600, color: muted }}>Code
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" aria-label="6-digit code"
              style={{ display: 'block', marginTop: 4, width: '100%', height: 52, borderRadius: 16, border: `1px solid ${line}`, padding: '0 16px', fontSize: 22, letterSpacing: '0.3em', fontFamily: 'inherit', color: ink, boxSizing: 'border-box' }} />
          </label>
          <button type="button" disabled={!!busy} onClick={() => void confirm()} style={{ ...btn, marginTop: 10, width: '100%', background: ink, color: '#fff' }}>{busy === 'confirm' ? 'Checking…' : 'Confirm'}</button>
          <button type="button" disabled={!!busy} onClick={() => { setVid(''); setCode(''); setErr(''); }} style={{ ...btn, marginTop: 8, width: '100%', background: 'transparent', color: ink }}>Send a new code</button>
        </div>
      )}
      {err ? <p role="alert" style={{ margin: '12px 0 0', fontSize: 14, color: warn }}>{err}</p> : null}
      {onClose && !expired ? <button type="button" onClick={onClose} style={{ ...btn, marginTop: 8, width: '100%', background: 'transparent', color: muted }}>Not now</button> : null}
    </div>
  );
  if (expired) return <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: '#fff' }}>{body}</div>;
  return (
    <div role="dialog" aria-modal="true" aria-label="Confirm it’s you" style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(22,23,26,.35)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: '#fff', borderRadius: '24px 24px 0 0', padding: '24px 20px calc(24px + env(safe-area-inset-bottom))', boxSizing: 'border-box' }}>{body}</div>
    </div>);
}
