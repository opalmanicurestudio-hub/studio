'use client';
// src/components/settings/PageDesignPicker.tsx — Settings → Booking → Page design.
// Classic = the page-builder page; Studio = the warm design that matches the
// school website. Each has a Preview link (?design=…) that opens the booking
// page in that design without changing anything.
import { useState } from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';

const OPTIONS: { id: 'classic' | 'studio'; title: string; text: string }[] = [
  { id: 'classic', title: 'Classic', text: 'The page you design in the page builder — your sections, theme and layout.' },
  { id: 'studio', title: 'Studio', text: 'A calm, warm page built from your own details: services, team, reviews and how to find you. Simple for every client.' },
];

export function PageDesignPicker({ firestore, tenantId, current }: { firestore: Firestore | null; tenantId: string; current?: string | null }) {
  const [value, setValue] = useState<'classic' | 'studio'>(current === 'studio' ? 'studio' : 'classic');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const pick = async (id: 'classic' | 'studio') => {
    if (!firestore || !tenantId || id === value) return; setBusy(true); setMsg('');
    try { await updateDoc(doc(firestore, 'tenants', tenantId), { 'bookingPageSettings.design': id }); setValue(id); setMsg(id === 'studio' ? 'Your booking page now uses the Studio design.' : 'Your booking page now uses your Classic page-builder design.'); }
    catch (e: any) { setMsg(e?.message || 'Couldn’t save — please try again.'); } finally { setBusy(false); }
  };
  return (
    <section className="space-y-3 rounded-2xl border-2 p-4" aria-label="Booking page design">
      <div><p className="font-black">Page design</p><p className="text-sm text-muted-foreground">How your public booking page looks. Booking works the same in both.</p></div>
      <div className="grid gap-2 sm:grid-cols-2">{OPTIONS.map((o) => (
        <div key={o.id} className={`space-y-2 rounded-xl border-2 p-3 ${value === o.id ? 'border-foreground' : ''}`}>
          <label className="flex cursor-pointer items-start gap-2"><input type="radio" name="page-design" className="mt-1" checked={value === o.id} disabled={busy} onChange={() => void pick(o.id)} />
            <span><span className="block font-bold">{o.title}{value === o.id ? ' · in use' : ''}</span><span className="block text-[13px] text-muted-foreground">{o.text}</span></span></label>
          <a href={`/book/${tenantId}?design=${o.id}`} target="_blank" rel="noreferrer" className="inline-block text-[13px] font-bold underline underline-offset-2">Preview ↗</a>
        </div>
      ))}</div>
      {msg && <p className="text-sm" role="status">{msg}</p>}
    </section>
  );
}
