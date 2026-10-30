'use client';
// src/components/shop/DeliveryLive.tsx — ON THE ORDER PAGE WHILE A DELIVERY IS ON ITS WAY (mockup 1C, lib/delivery-live):
// a map drawn by the server while the driver shares where they are (roughly), when it should arrive, how many stops are
// before theirs, who's bringing it and in what, a message through the shop, and their note for the driver (they can
// change it, with their pass). The page looks again on its own (every few seconds to a minute), so all of it moves.
import * as React from 'react';
import { stopsWords, updatedWords } from '@/lib/delivery-live';
import { whenInSentence } from '@/lib/delivery-retry';

const ink = '#16171a'; const muted = '#6d7075'; const line = '#ececee'; const soft = '#f5f5f7'; const amber = '#b45309';

export type DeliveryLiveData = { eta: string; stopsBefore: number | null; vehicle: string; shop: string; updatedAt: string | null; map: string | null; noteEditable: boolean };

export function DeliveryLive({ live, driver, orderNumber, when, address, note, onMessage, saveNote }: {
  live: DeliveryLiveData; driver: string | null; orderNumber: number; when: string; address: string; note: string;
  onMessage: () => void; saveNote: (note: string) => Promise<string>;
}) {
  const [mapOk, setMapOk] = React.useState(true);
  const [edit, setEdit] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [said, setSaid] = React.useState<{ text: string; bad?: boolean } | null>(null);
  const [, tick] = React.useState(0);
  // "Updated 2 min ago" keeps counting between the page's looks.
  React.useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30e3); return () => clearInterval(t); }, []);
  React.useEffect(() => { setMapOk(true); }, [live.map]);
  const who = driver || 'Your driver';
  const whoIn = driver || 'your driver';
  const save = async () => {
    if (edit === null || busy) return;
    setBusy(true); setSaid(null);
    try { setSaid({ text: await saveNote(edit.trim()) }); setEdit(null); }
    catch (e: any) { setSaid({ text: e?.message || 'That didn’t save. Try again.', bad: true }); }
    finally { setBusy(false); }
  };
  const showMap = !!live.map && mapOk;
  return (
    <div className="overflow-hidden rounded-[2rem] border-2 bg-white text-left" style={{ color: ink }}>
      {showMap && (
        <div className="relative" style={{ background: '#eef0ec' }}>
          <img src={live.map as string} alt={`Map: roughly where ${whoIn} is, and your address`} onError={() => setMapOk(false)} className="block h-auto w-full" style={{ aspectRatio: '600 / 440' }} />
          {live.updatedAt && <p className="absolute right-4 top-4 m-0 rounded-full bg-white px-3 py-1.5 text-[12.5px] font-semibold">{updatedWords(live.updatedAt)}</p>}
        </div>)}
      <div className="space-y-3.5 p-5" style={showMap ? { marginTop: -18, position: 'relative', background: '#fff', borderRadius: '24px 24px 0 0' } : undefined}>
        <div className="space-y-1">
          <p className="m-0 text-[13px] font-semibold" style={{ color: muted }}>Out for delivery · order {String(orderNumber).padStart(4, '0')}</p>
          <p className="m-0 text-[28px] font-light leading-tight tracking-[-0.02em]">{live.eta ? `Arriving ${live.eta}` : when ? `Arriving ${whenInSentence(when)}` : 'On its way'}</p>
          {live.stopsBefore !== null && <p className="m-0 text-[14px]" style={{ color: muted }}>{stopsWords(live.stopsBefore)}</p>}
        </div>
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: soft }}>
          <span aria-hidden="true" className="grid h-11 w-11 flex-none place-items-center rounded-full text-[16px] font-semibold text-white" style={{ background: ink }}>{who.charAt(0).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[15px] font-semibold">{who} is bringing it</p>
            <p className="m-0 mt-0.5 text-[13px]" style={{ color: muted }}>{[live.vehicle, live.shop ? `from ${live.shop}’s team` : ''].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" onClick={onMessage} className="h-11 flex-none rounded-full bg-white px-4 text-[14px] font-semibold" style={{ border: `1px solid ${line}`, color: ink }}>Message</button>
        </div>
        {(note || live.noteEditable) && (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <p className="m-0 text-[13px] font-semibold" style={{ color: muted }}>For the driver</p>
              {live.noteEditable && edit === null && <button type="button" onClick={() => { setEdit(note); setSaid(null); }} className="min-h-11 text-[13.5px] font-semibold underline underline-offset-[3px]" style={{ color: ink }}>{note ? 'Change' : 'Add a note'}</button>}
            </div>
            {edit === null ? (note ? <p className="m-0 text-[14.5px]">{note}</p> : null) : (
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                <textarea value={edit} maxLength={200} rows={2} onChange={(e) => setEdit(e.target.value)} aria-label="Your note for the driver" placeholder="Leave it at the front desk"
                  className="w-full rounded-xl px-3 py-2 text-[16px] outline-none" style={{ border: `1px solid ${line}` }} />
                <div className="flex gap-2">
                  <button type="submit" disabled={busy} className="h-11 rounded-full px-5 text-[14px] font-semibold disabled:opacity-50" style={{ background: ink, color: '#fff' }}>{busy ? 'Saving…' : 'Save'}</button>
                  <button type="button" disabled={busy} onClick={() => setEdit(null)} className="h-11 rounded-full px-5 text-[14px] font-semibold" style={{ border: `1px solid ${line}`, color: ink, background: '#fff' }}>Cancel</button>
                </div>
              </form>)}
            {said && <p className="m-0 text-[13px]" role={said.bad ? 'alert' : 'status'} style={{ color: said.bad ? amber : '#1f7a4d' }}>{said.text}</p>}
          </div>)}
        {address && <p className="m-0 text-[13px]" style={{ color: muted }}>To {address}</p>}
        <p className="m-0 text-[12.5px] leading-snug" style={{ color: muted }}>{live.map
          ? `You see roughly where ${whoIn} is only while your order is on its way, and it stops once it’s delivered. Messages go through the shop, so neither of you sees the other’s number.`
          : 'Messages go through the shop, so neither of you sees the other’s number.'}</p>
      </div>
    </div>);
}
