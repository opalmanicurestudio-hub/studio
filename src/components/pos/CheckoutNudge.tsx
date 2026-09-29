'use client';
// src/components/pos/CheckoutNudge.tsx — ONE honest suggestion at checkout (membership · package · next visit),
// with the maths. "Add to this sale" uses the normal selling + enrolment path; "Not now" is remembered.
import * as React from 'react';
import { getAuth } from 'firebase/auth';

async function post(body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/checkout/nudges', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch(() => ({ ok: false }));
}

export function CheckoutNudge({ tenantId, client, cart, onCartChange }: { tenantId: string; client: any; cart: any[]; onCartChange: (c: any[]) => void }) {
  const [list, setList] = React.useState<any[]>([]); const [gone, setGone] = React.useState<string[]>([]); const [note, setNote] = React.useState<string | null>(null);
  React.useEffect(() => { let live = true; setList([]); setGone([]); setNote(null);
    if (tenantId && client?.id) post({ tenantId, clientId: client.id, action: 'suggest' }).then((r: any) => { if (live && r?.ok) setList(r.nudges || []); });
    return () => { live = false; }; }, [tenantId, client?.id]);
  const shown = list.filter((n) => !gone.includes(n.key) && !(n.item && cart.some((c: any) => c.id === n.item.id)));
  if (!shown.length && !note) return null;
  const done = (n: any, how: 'accepted' | 'decline', msg: string) => { setGone((g) => [...g, n.key]); setNote(msg); post({ tenantId, clientId: client.id, action: how, key: n.key }); };
  return (
    <div className="mb-4 space-y-2">
      {shown.map((n) => <div key={n.key} className="space-y-2 rounded-2xl border-2 border-primary/20 bg-primary/5 p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-primary">Worth mentioning</p>
        <p className="text-sm font-semibold">{n.title}</p>
        <p className="text-sm text-slate-600">{n.line}</p>
        <div className="flex flex-wrap gap-2">
          {n.item && <button type="button" onClick={() => { onCartChange([...cart, { id: n.item.id, name: n.item.name, quantity: 1, price: n.item.price, type: n.item.type }]); done(n, 'accepted', `${n.item.name} added to this sale — ${client.name?.split(' ')[0] || 'they'}’ll be enrolled when it’s paid.`); }}
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground">Add to this sale</button>}
          {n.rebook && <button type="button" onClick={() => { window.dispatchEvent(new CustomEvent('cf:resume-callback', { detail: { fromCheckout: true, snapshotKind: 'staff_book_sheet', snapshot: { clientId: client.id, serviceId: n.rebook.serviceId, date: n.rebook.date } } })); done(n, 'accepted', 'Opening the booking sheet…'); }}
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground">Book the next visit</button>}
          <button type="button" onClick={() => done(n, 'decline', 'Okay — we won’t suggest that to them again for a while.')} className="rounded-full border px-4 py-1.5 text-xs">Not now</button>
        </div>
      </div>)}
      {note && <p className="text-xs font-semibold text-slate-600">{note}</p>}
    </div>
  );
}
