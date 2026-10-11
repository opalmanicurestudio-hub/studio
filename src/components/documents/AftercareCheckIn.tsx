'use client';
// src/components/documents/AftercareCheckIn.tsx — "HOW IS IT HOLDING UP?" on the client's aftercare page (approved
// design, canvas row 24 "the check-in"). Two big answers. All good goes to the provider; Something's changed opens the
// business's Making it right report (when it has one) or tells the team to get in touch (/api/aftercare).
import * as React from 'react';

export function AftercareCheckIn({ tenantId, appointmentId, k, t, service, answered, reportHref }: { tenantId: string; appointmentId: string; k?: string; t?: string; service: string; answered?: string | null; reportHref?: string }) {
  const [answer, setAnswer] = React.useState<string | null>(answered || null); const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState('');
  const post = async (a: 'good' | 'changed') => {
    setBusy(a); setErr('');
    const r = await fetch('/api/aftercare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, appointmentId, k, t, answer: a }) }).then((x) => x.json()).catch(() => ({ ok: false }));
    setBusy(''); if (!r.ok) { setErr(r.error || 'That didn’t send. Try again.'); return; }
    setAnswer(a); if (a === 'changed' && reportHref) window.location.href = reportHref;
  };
  const btn = (a: 'good' | 'changed', label: string, bg: string, fg: string, icon: React.ReactNode) => <button type="button" disabled={!!busy} onClick={() => post(a)}
    style={{ height: 64, borderRadius: 18, background: bg, color: fg, display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', fontSize: 16, fontWeight: 600, border: 0, width: '100%', font: 'inherit', cursor: 'pointer', opacity: busy && busy !== a ? 0.5 : 1 }}>{icon}{busy === a ? 'Sending…' : label}</button>;
  if (answer === 'good') return <div style={{ padding: '16px 18px', borderRadius: 18, background: '#e9f3ed', color: '#1f5a3a', fontSize: 15 }}><b>Lovely — thank you!</b> We’ve let them know.</div>;
  if (answer === 'changed' && !reportHref) return <div style={{ padding: '16px 18px', borderRadius: 18, background: '#fdf3e6', color: '#7a3e05', fontSize: 15 }}><b>Thanks for telling us.</b> The team will be in touch soon.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 20, fontWeight: 400, letterSpacing: '-.02em' }}>How is your {service.toLowerCase()} holding up?</div>
      {btn('good', 'All good', '#e9f3ed', '#1f5a3a', <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1f7a4d" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>)}
      {btn('changed', 'Something’s changed', '#fdf3e6', '#7a3e05', <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></svg>)}
      {err && <div style={{ color: '#b42318', fontSize: 14 }}>{err}</div>}
    </div>);
}
