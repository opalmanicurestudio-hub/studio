'use client';
// "Saving for": the client picks the reward they're working toward, on their private rewards page (/api/loyalty/public).
import * as React from 'react';

export function GoalPicker({ tenantId, clientId, k, rewards, goalId, unit }: { tenantId: string; clientId: string; k: string; rewards: { id: string; name: string; points: number; ready: boolean }[]; goalId: string | null; unit: string }) {
  const [cur, setCur] = React.useState(goalId); const [busy, setBusy] = React.useState(''); const [open, setOpen] = React.useState(false);
  const choose = async (id: string) => { setBusy(id); const r = await fetch('/api/loyalty/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, clientId, k, action: 'goal', rewardId: id }) }).then((x) => x.json()).catch(() => null); setBusy('');
    if (r?.ok) { setCur(id); setOpen(false); window.location.reload(); } };
  if (rewards.length < 2) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button type="button" onClick={() => setOpen(!open)} style={{ alignSelf: 'flex-start', fontSize: 14, fontWeight: 600, textDecoration: 'underline', background: 'none', border: 0, padding: 0, color: '#16171a', cursor: 'pointer' }}>{open ? 'Close' : 'Change what you’re saving for'}</button>
      {open && rewards.map((r) => <button key={r.id} type="button" disabled={!!busy} onClick={() => choose(r.id)} style={{ textAlign: 'left', border: cur === r.id ? '2px solid #16171a' : '1px solid #ececee', borderRadius: 16, padding: '12px 14px', background: '#fff', fontSize: 14, display: 'flex', justifyContent: 'space-between', gap: 10, cursor: 'pointer', color: '#16171a' }}>
        <span><b style={{ fontWeight: 600 }}>{r.name}</b> <span style={{ color: '#6d7075' }}>· {r.points} {unit}</span></span><span style={{ color: r.ready ? '#1f7a4d' : '#6d7075', fontWeight: 600 }}>{busy === r.id ? 'Saving…' : cur === r.id ? 'Saving for this' : r.ready ? 'Ready' : ''}</span></button>)}
    </div>);
}
