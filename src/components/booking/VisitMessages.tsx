'use client';
// src/components/booking/VisitMessages.tsx — "MESSAGE US" on the client's visit link. The thread between the client
// and the business (their messages on the right, ours on the left), a box to write, and the notifications card.
// Everything goes through /api/appt ('messages' to read, 'message' to send). Refreshes every 20 seconds while open.
import React from 'react';
import { format, isToday } from 'date-fns';
import { VisitShell, VisitCard, VisitButton, VisitMuted, type VisitBrand } from '@/components/booking/VisitShell';
import { ClientNotifyCard } from '@/components/booking/ClientNotifyCard';

type Item = { id: string; at: string; dir: 'in' | 'out'; who: string; text: string; channel?: string };
const when = (at: string) => { const d = new Date(at); if (isNaN(d.getTime())) return ''; return isToday(d) ? format(d, 'h:mm a') : format(d, 'MMM d, h:mm a'); };

export function VisitMessages({ brand, tenantId, api, onBack }: { brand: VisitBrand; tenantId: string; api: (payload: any) => Promise<any>; onBack: () => void }) {
  const [items, setItems] = React.useState<Item[] | null>(null);
  const [loadErr, setLoadErr] = React.useState('');
  const [text, setText] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const endRef = React.useRef<HTMLDivElement | null>(null);
  const apiRef = React.useRef(api); apiRef.current = api;

  const load = React.useCallback(async () => {
    const r = await apiRef.current({ action: 'messages' });
    if (r?.ok) { setItems(Array.isArray(r.items) ? r.items : []); setLoadErr(''); }
    else setLoadErr(r?.error || 'We couldn’t load your messages. Please try again.');
  }, []);
  React.useEffect(() => {
    let stop = false; let t: any = null;
    const tick = async () => { await load(); if (!stop) t = setTimeout(tick, 20000); };
    tick(); return () => { stop = true; clearTimeout(t); };
  }, [load]);
  const count = items?.length || 0;
  React.useEffect(() => { if (count) endRef.current?.scrollIntoView({ block: 'end' }); }, [count]);

  const send = async () => {
    const body = text.trim(); if (!body || busy) return;
    setBusy(true); setErr('');
    const r = await api({ action: 'message', text: body });
    setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'Your message didn’t send. Please try again.'); return; }
    setText(''); await load();
  };

  return (
    <VisitShell brand={brand} title={<>Message <b>us</b></>}>
      <VisitCard>
        {items === null && !loadErr ? <VisitMuted>Loading your messages…</VisitMuted>
          : !count ? <VisitMuted>Send us a message about your appointment, and we’ll reply here.</VisitMuted>
          : <div className="space-y-3" aria-live="polite">
            {items!.map((m) => {
              const mine = m.dir === 'in';
              return (
                <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[15px]"
                    style={mine ? { background: 'var(--ink, #16171a)', color: '#fff', borderBottomRightRadius: 6 } : { background: '#f1ece6', borderBottomLeftRadius: 6 }}>{m.text}</div>
                  <p className="mt-1 px-1 text-[12px]" style={{ color: 'var(--muted)' }}>{mine ? 'You' : (m.who || 'Us')}{when(m.at) ? ` · ${when(m.at)}` : ''}</p>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>}
        {loadErr && <p className="text-[14px]" style={{ color: '#b42318' }}>{loadErr}</p>}
      </VisitCard>
      <VisitCard>
        <textarea aria-label="Your message" value={text} onChange={(e) => setText(e.target.value)} maxLength={1600} rows={3} placeholder="Write your message"
          className="w-full rounded-2xl bg-white px-4 py-3 text-[15px] outline-none" style={{ border: '1px solid #e7e2dc' }} />
        {err && <p className="text-[14px]" style={{ color: '#b42318' }}>{err}</p>}
        <VisitButton onClick={send} disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send'}</VisitButton>
      </VisitCard>
      <ClientNotifyCard tenantId={tenantId} api={api} />
      <VisitButton quiet onClick={onBack}>Back</VisitButton>
    </VisitShell>
  );
}
