'use client';
// src/components/booking/PartyBuilder.tsx — ONLINE: "Bringing someone?" and "Add another service".
// Guests each pick their own service; another service for yourself goes side by side (another provider, same time) or
// straight after. Whatever's added is sent as one request — the studio confirms, then asks for any deposit. The
// business's rules (Settings → Group bookings) decide whether it shows, how many guests, and which options appear.
import * as React from 'react';

export type PartyGuest = { name: string; serviceId: string; email?: string; phone?: string };
export type PartyExtra = { serviceId: string; when: 'side' | 'after' };
export type Party = { guests: PartyGuest[]; extras: PartyExtra[] };
export const emptyParty: Party = { guests: [], extras: [] };
export const partyHasMore = (p?: Party | null) => !!p && (p.guests.length > 0 || p.extras.length > 0);

export function PartyBuilder({ policy, services, mainServiceId, party, onChange, accent }: {
  policy: { enabled: boolean; maxGuests: number; deposits: 'organizer' | 'each'; sideBySide: boolean; after: boolean };
  services: any[]; mainServiceId: string; party: Party; onChange: (p: Party) => void; accent?: string;
}) {
  if (!policy.enabled) return null;
  const list = services.filter((s) => s.isActive !== false && s.status !== 'archived' && !s.isPrivate && s.type !== 'addon' && !s.isAddon && !s.renterProviderId && !s.renterId);
  const set = (patch: Partial<Party>) => onChange({ ...party, ...patch });
  const field = 'h-11 w-full rounded-xl border px-3 text-[15px]'; const line = { borderColor: '#e7e2dc', background: '#fff' } as React.CSSProperties;
  const ink = accent || 'var(--accent, #7c3aed)';
  return (
    <section className="mb-4 space-y-4 rounded-3xl bg-white p-5 shadow-sm" aria-label="Guests and more services">
      <div className="space-y-2">
        <p className="text-[15px] font-semibold">Bringing someone?</p>
        {party.guests.map((g, i) => (
          <div key={i} className="space-y-2 rounded-2xl border p-3" style={{ borderColor: '#e7e2dc' }}>
            <div className="flex items-center justify-between"><span className="text-[13px] font-semibold text-stone-500">Guest {i + 1}</span><button type="button" onClick={() => set({ guests: party.guests.filter((_, j) => j !== i) })} className="text-[13px] text-stone-500 underline">Remove</button></div>
            <input value={g.name} onChange={(e) => set({ guests: party.guests.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="Their name" aria-label={`Guest ${i + 1} name`} className={field} style={line} />
            <select value={g.serviceId} onChange={(e) => set({ guests: party.guests.map((x, j) => (j === i ? { ...x, serviceId: e.target.value } : x)) })} aria-label={`Guest ${i + 1} service`} className={field} style={line}>{list.map((s) => <option key={s.id} value={s.id}>{s.name}{s.duration ? ` · ${s.duration} min` : ''}</option>)}</select>
            {policy.deposits === 'each' && <div className="grid grid-cols-2 gap-2"><input value={g.email || ''} onChange={(e) => set({ guests: party.guests.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)) })} placeholder="Their email (optional)" type="email" className={field} style={line} /><input value={g.phone || ''} onChange={(e) => set({ guests: party.guests.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)) })} placeholder="Their phone (optional)" type="tel" className={field} style={line} /></div>}
          </div>))}
        {party.guests.length < policy.maxGuests
          ? <button type="button" onClick={() => set({ guests: [...party.guests, { name: '', serviceId: mainServiceId || list[0]?.id || '' }] })} className="h-10 rounded-full border px-4 text-[14px] font-semibold" style={{ borderColor: ink, color: ink }}>+ Add a guest</button>
          : <p className="text-[13px] text-stone-500">Up to {policy.maxGuests} guest{policy.maxGuests === 1 ? '' : 's'} online — call us for a bigger group.</p>}
      </div>
      {(policy.sideBySide || policy.after) && <div className="space-y-2 border-t pt-4" style={{ borderColor: '#efebe6' }}>
        <p className="text-[15px] font-semibold">Add another service for you</p>
        {party.extras.map((x, i) => (
          <div key={i} className="space-y-2 rounded-2xl border p-3" style={{ borderColor: '#e7e2dc' }}>
            <select value={x.serviceId} onChange={(e) => set({ extras: party.extras.map((y, j) => (j === i ? { ...y, serviceId: e.target.value } : y)) })} aria-label={`Extra service ${i + 1}`} className={field} style={line}>{list.filter((s) => s.id !== mainServiceId).map((s) => <option key={s.id} value={s.id}>{s.name}{s.duration ? ` · ${s.duration} min` : ''}</option>)}</select>
            <div className="flex flex-wrap gap-2">
              {policy.sideBySide && <button type="button" aria-pressed={x.when === 'side'} onClick={() => set({ extras: party.extras.map((y, j) => (j === i ? { ...y, when: 'side' } : y)) })} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={x.when === 'side' ? { background: ink, color: '#fff' } : { background: '#f3f0ec' }}>At the same time</button>}
              {policy.after && <button type="button" aria-pressed={x.when === 'after'} onClick={() => set({ extras: party.extras.map((y, j) => (j === i ? { ...y, when: 'after' } : y)) })} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={x.when === 'after' ? { background: ink, color: '#fff' } : { background: '#f3f0ec' }}>Straight after</button>}
              <button type="button" onClick={() => set({ extras: party.extras.filter((_, j) => j !== i) })} className="ml-auto text-[13px] text-stone-500 underline">Remove</button>
            </div>
          </div>))}
        {party.extras.length < 2 && <button type="button" onClick={() => set({ extras: [...party.extras, { serviceId: list.find((s) => s.id !== mainServiceId)?.id || '', when: policy.sideBySide ? 'side' : 'after' }] })} className="h-10 rounded-full border px-4 text-[14px] font-semibold" style={{ borderColor: ink, color: ink }}>+ Add another service</button>}
      </div>}
      {(party.guests.length > 0 || party.extras.length > 0) && <p className="rounded-2xl bg-stone-50 p-3 text-[13px] text-stone-600">This goes to us as one request. We’ll confirm everything together{policy.deposits === 'organizer' ? ', then ask you for the deposits in one go' : ', then ask for any deposit'} — nothing is charged until we do.</p>}
    </section>);
}
