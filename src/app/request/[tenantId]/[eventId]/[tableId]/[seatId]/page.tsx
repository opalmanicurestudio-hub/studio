'use client';
// src/app/request/[tenantId]/[eventId]/[tableId]/[seatId]/page.tsx — A SEAT'S QR CODE AT AN EVENT (printed from the
// seating chart). The guest taps what they need and it goes onto the floor board (/floor), with their table and seat.
// Read and sent through /api/public/event; only open on the day of the event.
import * as React from 'react';
import { useParams } from 'next/navigation';
import { BusinessHead, Button, CARD, INK, LINE, MUTED, Note, AMBER, Shell, askEvent } from '@/components/events/guest-shell';

export default function SeatRequestPage() {
  const { tenantId, eventId, tableId, seatId } = useParams() as { tenantId: string; eventId: string; tableId: string; seatId: string };
  const [d, setD] = React.useState<any>(null); const [err, setErr] = React.useState('');
  const [pick, setPick] = React.useState<any>(null); const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState(''); const [sent, setSent] = React.useState<string | null>(null);
  const [wait, setWait] = React.useState(0);

  React.useEffect(() => {
    askEvent({ action: 'load', purpose: 'seat', tenantId, eventId, tableId, seatId }).then((r) => {
      if (!r.ok) { setErr(r.error || 'We couldn’t load this seat.'); return; }
      setD(r); setWait(r.seat?.waitSeconds || 0);
    });
  }, [tenantId, eventId, tableId, seatId]);
  React.useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000); return () => clearTimeout(t); }, [wait]);

  if (err) return <Shell><Note>{err}</Note></Shell>;
  if (!d) return <Shell><p className="text-[15px]" style={{ color: MUTED }}>Loading…</p></Shell>;
  const color = d.business?.color; const s = d.seat;
  const head = <><BusinessHead business={d.business} />
    <div><p className="text-[15px]" style={{ color: MUTED }}>{d.event?.title}</p>
      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">{s?.firstName ? `Hi ${s.firstName}` : 'What can we bring you?'}</h1>
      {s && <p className="mt-1 text-[15.5px]">{s.tableName} · Seat {s.seatLabel}</p>}</div></>;
  if (d.closed) return <Shell>{head}<Note>{d.message}</Note></Shell>;
  if (!s.open) return <Shell>{head}<Note>Requests open on the day of the event.</Note></Shell>;

  const send = async () => {
    if (!pick) return; setBusy(true); setMsg('');
    const r = await askEvent({ action: 'request', tenantId, eventId, tableId, seatId, type: pick.id, note: pick.note ? note : '' });
    setBusy(false);
    if (r.waitSeconds) setWait(r.waitSeconds);
    if (!r.ok) { setMsg(r.error || 'That didn’t go through. Please wave to a member of the team.'); return; }
    setSent(r.label); setPick(null); setNote('');
  };

  if (sent) return <Shell>{head}
    <div className="space-y-1 p-5" style={CARD}><p className="text-[20px] font-semibold">Got it</p><p className="text-[15.5px]">The team has your request ({sent.toLowerCase()}). Someone will be right over.</p></div>
    <button type="button" disabled={wait > 0} onClick={() => setSent(null)} className="h-[54px] w-full rounded-full border bg-white text-[16px] font-medium disabled:opacity-50" style={{ borderColor: LINE }}>
      {wait > 0 ? `Ask for something else in ${wait}s` : 'Ask for something else'}</button>
  </Shell>;

  return <Shell>{head}
    {wait > 0 && <p className="text-[14.5px]" style={{ color: MUTED }}>You can ask again in {wait} seconds.</p>}
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What you need">
      {s.types.map((t: any) => { const on = pick?.id === t.id; return <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => { setPick(t); setMsg(''); }}
        className="min-h-[56px] rounded-2xl border px-3 py-2 text-left text-[15px] leading-snug" style={on ? { background: INK, color: '#fff', borderColor: INK } : { background: '#fff', borderColor: LINE }}>{t.label}</button>; })}
    </div>
    {pick?.note && <label className="block text-[13px] font-medium">Tell us more <span style={{ color: MUTED }}>(optional)</span>
      <textarea value={note} onChange={(x) => setNote(x.target.value.slice(0, 160))} rows={2} className="mt-1.5 w-full rounded-2xl border bg-white px-3.5 py-3 text-[16px] outline-none focus:border-[#16171a]" style={{ borderColor: LINE }} /></label>}
    {msg && <p className="text-[14px] font-medium" style={{ color: AMBER }} role="alert">{msg}</p>}
    <Button color={color} disabled={!pick || busy || wait > 0} onClick={send}>{busy ? 'Sending…' : pick ? 'Send' : 'Choose what you need'}</Button>
  </Shell>;
}
