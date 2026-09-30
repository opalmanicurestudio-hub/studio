'use client';
// src/components/pos/desk/AddWalkIn.tsx — ADD A WALK-IN AT THE DESK. Same queue route as the kiosk (assignment, fair turns,
// forms, the visit ticket), so a guest at the counter needn't be sent to the kiosk. Staff don't need the kiosk switched on.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { printAppointmentTicket } from '@/lib/appointment-ticket';
import { openVisit } from '@/lib/visit-client';

export function AddWalkIn({ tenantId, tenant, services, staff, onDone }: { tenantId: string; tenant: any; services: any[]; staff: any[]; onDone?: () => void }) {
  const svcs = (services || []).filter((x: any) => x && x.type !== 'addon' && !x.isAddon && x.isActive !== false && !x.archived);
  const [name, setName] = React.useState(''); const [phone, setPhone] = React.useState(''); const [serviceId, setServiceId] = React.useState('');
  const [pref, setPref] = React.useState(''); const [wait, setWait] = React.useState(false); const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState<string | null>(null); const [res, setRes] = React.useState<any>(null);
  const can = (m: any) => { const s: any = svcs.find((x: any) => x.id === serviceId); return !s || !Array.isArray(s.staffIds) || !s.staffIds.length || s.staffIds.includes(m.id); };
  const people = (staff || []).filter((m: any) => m.isActive !== false && m.active !== false && can(m));
  const submit = async () => {
    setBusy(true); setErr(null);
    const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
    const r: any = await fetch('/api/walkins', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
      body: JSON.stringify({ tenantId, source: 'desk', name: name.trim(), phone: phone.trim(), serviceId, ...(pref ? { preferredStaffId: pref, waitForPreferred: wait } : {}), note: note.trim() }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the server.' }));
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || (r?.needsForms ? 'This service needs forms signed first — add them at the kiosk or on their link.' : 'They couldn’t be added.')); return; }
    setRes(r);
  };
  const print = (size: 'letter' | 'receipt') => printAppointmentTicket({ id: `apt-walkin-${res.walkInId}`, clientName: res.clientName, checkInToken: res.checkInToken, shortCode: res.shortCode },
    { studioName: tenant?.name, clientName: res.clientName, serviceName: res.serviceName, staffName: res.staffName, kind: 'walkin', queuePosition: res.assigned ? null : res.position, estWaitMin: res.estWaitMin,
      accent: tenant?.bookingPageSettings?.cfPageConfig?.accentColor || tenant?.brandColor, logoUrl: tenant?.logoUrl || tenant?.bookingPageSettings?.cfPageConfig?.logoUrl, size, origin: window.location.origin } as any);
  const box = { background: 'var(--card)', border: '1px solid var(--line)' } as React.CSSProperties; const soft = { background: 'var(--soft)' } as React.CSSProperties;
  const inp = 'h-12 w-full rounded-xl px-4 text-[16px] outline-none'; const inpS = { background: 'var(--paper)', border: '1px solid var(--line)' } as React.CSSProperties;
  if (res) return (
    <div className="space-y-3">
      <section className="space-y-1 rounded-3xl p-4" style={box}>
        <p className="text-[18px] font-semibold">{res.alreadyInLine ? `${res.clientName || 'They'} are already in line` : `${res.clientName} is in`}</p>
        <p className="text-[15px]" style={{ color: 'var(--muted)' }}>{res.serviceName}{res.assigned && res.staffName ? ` · with ${String(res.staffName).split(' ')[0]} now` : ` · #${res.position} in line${res.estWaitMin ? ` · about ${res.estWaitMin} min` : ''}`}</p>
        {res.shortCode && <p className="text-[15px] font-semibold tracking-[0.2em] tabular-nums">{res.shortCode}</p>}
        {res.needsFrontDesk && <p className="text-[13px] font-semibold" style={{ color: 'var(--warn)' }}>Nobody on the floor offers this right now — assign them yourself.</p>}
      </section>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => print('letter')} className="h-11 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Print ticket</button>
        <button type="button" onClick={() => print('receipt')} className="h-11 rounded-full px-4 text-[14px]" style={soft}>Print receipt size</button>
        <button type="button" onClick={() => { openVisit(`apt-walkin-${res.walkInId}`); onDone?.(); }} className="h-11 rounded-full px-4 text-[14px]" style={soft}>Open their ticket</button>
        <button type="button" onClick={() => { setRes(null); setName(''); setPhone(''); setNote(''); setPref(''); setWait(false); }} className="h-11 rounded-full px-4 text-[14px]" style={soft}>Add another</button>
      </div>
    </div>);
  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-3xl p-4" style={box}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name" aria-label="Name" autoComplete="off" className={inp} style={inpS} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile (optional — we text when it’s their turn)" aria-label="Mobile" inputMode="tel" autoComplete="off" className={inp} style={inpS} />
        <select value={serviceId} onChange={(e) => { setServiceId(e.target.value); setPref(''); }} aria-label="Service" className={inp} style={inpS}>
          <option value="">Choose a service…</option>{svcs.map((x: any) => <option key={x.id} value={x.id}>{x.name}{x.duration ? ` · ${x.duration} min` : ''}</option>)}
        </select>
        {serviceId && <select value={pref} onChange={(e) => setPref(e.target.value)} aria-label="Provider" className={inp} style={inpS}>
          <option value="">Next available</option>{people.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>}
        {pref && <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={wait} onChange={(e) => setWait(e.target.checked)} /> Wait for them, even if someone else is free sooner</label>}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the team (optional)" aria-label="Note" className={inp} style={inpS} />
      </section>
      {err && <p className="text-[14px] font-semibold" style={{ color: 'var(--warn)' }} role="alert">{err}</p>}
      <button type="button" disabled={busy || !name.trim() || !serviceId} onClick={submit} className="h-12 w-full rounded-full text-[15px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{busy ? 'Adding…' : 'Add to the queue'}</button>
      <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Same queue as the kiosk — they’re given the next fair turn (or wait for who you picked), get a visit ticket, and a text when it’s their turn.</p>
    </div>
  );
}
