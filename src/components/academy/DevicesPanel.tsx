'use client';
// src/components/academy/DevicesPanel.tsx
//
// APPROVED DEVICES — "Student records only on approved devices" (NC: personal
// devices may not be used to access student records). The owner switches it
// on (this device is approved automatically), approves requests, removes
// devices. Staff on an unapproved device can request approval.

import { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { deviceId, deviceName } from '@/lib/device';

async function api(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/academy/school', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'No response' }));
}

export function DevicesPanel({ tenantId }: { tenantId: string }) {
  const [d, setD] = useState<any>(null); const [msg, setMsg] = useState('');
  const me = typeof window !== 'undefined' ? deviceId() : '';
  const load = useCallback(async () => setD(await api({ action: 'devices', tenantId, deviceId: me })), [tenantId, me]);
  useEffect(() => { void load(); }, [load]);
  if (!d?.ok) return null;
  const act = async (body: any, done: string) => { const r = await api({ tenantId, ...body }); setMsg(r.ok ? done : r.error); await load(); };
  const devices = (d.devices || []).filter((x: any) => x.status !== 'removed');
  return (
    <section className="space-y-3 rounded-2xl bg-muted/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="font-black">Student records only on approved devices</p><p className="text-[12px] text-muted-foreground">North Carolina: personal devices may not be used to access student records. When on, student files, admissions, reports, attendance and grades open only on devices you approve.</p></div>
        {d.isOwner && <button type="button" role="switch" aria-checked={d.on} onClick={() => act({ action: 'devices-setting', on: !d.on, deviceId: me, name: deviceName() }, d.on ? 'Records open on any signed-in device.' : 'On — this device was approved automatically.')} className={`relative h-8 w-14 shrink-0 rounded-full ${d.on ? 'bg-emerald-600' : 'bg-stone-300'}`}><span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${d.on ? 'left-7' : 'left-1'}`} /></button>}
      </div>
      <p className="text-sm">This device ({deviceName()}): <b>{d.mine === 'approved' ? '✓ approved' : d.mine === 'pending' ? 'waiting for approval' : 'not approved'}</b>
        {d.mine !== 'approved' && (d.isOwner ? <button type="button" onClick={() => act({ action: 'device-approve', deviceId: me, name: deviceName() }, 'This device is approved.')} className="ml-2 underline">Approve it</button> : d.mine !== 'pending' && <button type="button" onClick={() => act({ action: 'device-request', deviceId: me, name: deviceName() }, 'Request sent to the owner.')} className="ml-2 underline">Request approval</button>)}</p>
      {msg && <p className="text-sm text-emerald-800">{msg}</p>}
      {d.isOwner && devices.length > 0 && (
        <div className="space-y-1">{devices.map((x: any) => (
          <div key={x.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-background px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">{x.name}{x.id === me ? ' (this device)' : ''} <span className="text-[11px] text-muted-foreground">· {x.status === 'approved' ? `approved ${new Date(x.approvedAt).toLocaleDateString()}` : `requested by ${x.requestedBy}`}</span></span>
            {x.status === 'pending' && <button type="button" onClick={() => act({ action: 'device-approve', deviceId: x.id, name: x.name }, 'Approved.')} className="h-8 rounded-lg bg-emerald-600 px-3 text-[12px] font-bold text-white">Approve</button>}
            <button type="button" onClick={() => { if (window.confirm(`Remove ${x.name}?`)) void act({ action: 'device-remove', deviceId: x.id }, 'Removed.'); }} className="h-8 rounded-lg border-2 px-3 text-[12px] font-bold">Remove</button>
          </div>
        ))}</div>
      )}
    </section>
  );
}
