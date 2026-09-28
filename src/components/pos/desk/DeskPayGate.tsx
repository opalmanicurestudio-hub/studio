'use client';
// src/components/pos/desk/DeskPayGate.tsx — "ARRIVED — PAYMENT REQUIRED".
// A guest who's here but hasn't paid a required deposit can't be started until
// it's collected — or an authorised exception is recorded (manager + reason).
// Then the service starts from the POS in the same step.
import { useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Drawer, Btn } from './kit';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
async function staffPost(url: string, body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}

export function DeskPayGate({ e, appt, accent, onClose }: { e: any; appt: any | null; accent?: string | null; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState(''); const [why, setWhy] = useState(''); const [excOpen, setExcOpen] = useState(false);
  if (!appt) return <Drawer accent={accent} open={false} onClose={onClose} title="">{null}</Drawer>;
  const first = String(appt.clientName || 'Guest').split(' ')[0];
  const cents = Number(appt.depositAmountCents) || 0;
  const client = (e.clients || []).find((c: any) => c.id === appt.clientId);
  const card = client?.cardOnFile; const hasCard = !!(card?.paymentMethodId || card?.token);
  const isMgr = ['owner', 'admin', 'manager'].includes(String(e.role || '').toLowerCase()) || e.selectedTenant?.userId === e.currentUser?.uid;
  const run = async (key: string, body: any) => {
    setBusy(key); setErr('');
    const r = await staffPost('/api/appointments/desk-deposit', { tenantId: e.tenantId, appointmentId: appt.id, ...body });
    setBusy(null);
    if (!r?.ok) { setErr(r?.error || 'That didn’t go through — please try again.'); return; }
    e.handleStartService(appt.id);   // collected (or an exception recorded) → start
    onClose();
  };
  return (
    <Drawer accent={accent} open onClose={onClose} title={`${first} is here — payment required`}>
      <div className="space-y-3">
        <section className="space-y-2 rounded-3xl p-4" style={{ background: 'var(--card)' }}>
          <p className="text-[15px]">{cents > 0 ? <>A <b>{money(cents)}</b> deposit is required before starting.</> : 'A deposit is required before starting.'}</p>
          <p className="text-[13px]" style={{ color: 'var(--muted)' }}>Collect it now, or record an exception — either way the service starts straight after.</p>
        </section>
        {hasCard && <Btn big className="w-full" disabled={!!busy} onClick={() => run('charge', { action: 'charge' })}>{busy === 'charge' ? 'Charging…' : `Charge ${card?.brand || 'card'} •••• ${card?.last4 || ''} & start`}</Btn>}
        {!hasCard && <p className="text-[13px]" style={{ color: 'var(--muted)' }}>No card on file — add the deposit to today’s bill at checkout, or record an exception.</p>}
        {!excOpen ? <Btn quiet className="w-full" onClick={() => setExcOpen(true)}>Start without it (exception)…</Btn> : (
          <section className="space-y-2 rounded-3xl p-4" style={{ background: 'var(--card)' }}>
            {isMgr ? <>
              <input value={why} onChange={(ev) => setWhy(ev.target.value)} placeholder="Reason (required) — e.g. paying at checkout, regular client" className="h-11 w-full rounded-xl px-3 text-[14px] outline-none" style={{ background: 'var(--soft)' }} />
              <Btn className="w-full" disabled={!why.trim() || !!busy} onClick={() => run('waive', { action: 'waive', reason: why.trim() })}>{busy === 'waive' ? 'Recording…' : 'Record exception & start'}</Btn>
            </> : <p className="text-[13px]">Only a manager or the owner can start without the deposit.</p>}
          </section>
        )}
        {err && <p className="text-[13px] font-semibold" style={{ color: 'var(--warn)' }}>{err}</p>}
      </div>
    </Drawer>
  );
}
