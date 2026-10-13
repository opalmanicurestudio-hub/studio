'use client';
// src/components/rent/RenterMessages.tsx — A RENTER'S MESSAGES (design canvas RF5). When a client answers one of the
// renter's texts, it lands here (lib/renter-inbox), not with the studio. Conversations newest first; open one to read
// and reply. /api/portal/renter-messages.
import * as React from 'react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', RED = '#b42318';
const font = { color: INK, fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' } as const;
const call = (body: any) => fetch('/api/portal/renter-messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'That didn’t work. Please try again.' }));
const when = (iso: string) => { const d = new Date(iso); const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
const pretty = (p: string) => { const d = String(p || '').replace(/\D+/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p; };

export function RenterMessages({ tenantId, token, always = false }: { tenantId: string; token: string; always?: boolean }) {
  const [d, setD] = React.useState<any>(null); const [open, setOpen] = React.useState<string | null>(null);
  const [text, setText] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const load = React.useCallback(() => call({ tenantId, token, action: 'list' }).then(setD), [tenantId, token]);
  React.useEffect(() => { void load(); const id = setInterval(() => { void load(); }, 30000); return () => clearInterval(id); }, [load]);
  if (!d?.ok) return null;
  const threads: any[] = d.threads || []; if (!threads.length && !always) return null;
  const th = threads.find((x) => x.key === open) || null;
  const openThread = async (key: string) => { setOpen(key); setErr(''); setText(''); await call({ tenantId, token, action: 'read', key }); void load(); };
  const send = async () => { if (!th || !text.trim()) return; setBusy(true); setErr(''); const r = await call({ tenantId, token, action: 'send', key: th.key, body: text });
    setBusy(false); if (r?.ok) { setText(''); void load(); } else setErr(r?.error || 'That didn’t send.'); };
  return (
    <section className="space-y-3" style={font} aria-label="Messages">
      <div className="flex items-end justify-between"><div><p className="text-[12px] tracking-[0.1em]" style={{ color: MUTED }}>my business</p><h2 className="text-[24px] font-light tracking-[-0.02em]">Messages</h2></div>
        {d.unread > 0 && <span className="rounded-full px-2.5 py-1 text-[12px] font-bold text-white" style={{ background: INK }}>{d.unread} new</span>}</div>
      {!th ? <div className="space-y-2">
        {threads.map((x) => { const lastIn = [...x.messages].reverse().find((m: any) => m.direction === 'in') || x.messages[x.messages.length - 1];
          return <button key={x.key} type="button" onClick={() => openThread(x.key)} className="block w-full rounded-[16px] border bg-white p-3.5 text-left" style={{ borderColor: LINE }}>
            <span className="flex items-center justify-between gap-2"><span className="text-[14.5px] font-semibold">{x.clientName || pretty(x.phone)}</span>{x.unread > 0 ? <span className="rounded-full px-2 py-0.5 text-[11.5px] font-bold text-white" style={{ background: INK }}>New</span> : <span className="text-[12px]" style={{ color: MUTED }}>{when(x.lastAt)}</span>}</span>
            <span className="mt-0.5 block truncate text-[13px]" style={{ color: MUTED }}>“{lastIn?.body || 'A photo'}”</span></button>; })}
        {!threads.length && <p className="rounded-[16px] p-3.5 text-[13px]" style={{ background: SOFT, color: MUTED }}>When a client replies to one of your texts, it comes here and you get an alert. The studio can’t read your messages.</p>}
      </div> : <div className="space-y-3 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}>
        <div className="flex items-center justify-between gap-2"><span className="text-[15px] font-semibold">{th.clientName || pretty(th.phone)}</span>
          <span className="flex gap-2"><a href={`tel:+1${th.key}`} className="rounded-full border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: LINE }}>Call</a>
            <button type="button" onClick={() => setOpen(null)} className="rounded-full border px-3 py-1.5 text-[12.5px]" style={{ borderColor: LINE }}>All messages</button></span></div>
        <div className="max-h-[420px] space-y-2 overflow-y-auto">{th.messages.map((m: any) => <div key={m.id} className={`flex flex-col ${m.direction === 'out' ? 'items-end' : 'items-start'} gap-0.5`}>
          <div className="max-w-[85%] whitespace-pre-line rounded-[16px] px-3 py-2 text-[13.5px] leading-[1.45]" style={{ background: m.direction === 'out' ? INK : SOFT, color: m.direction === 'out' ? '#fff' : INK }}>{m.body || 'A photo (open it in the studio’s messages)'}</div>
          <span className="text-[11px]" style={{ color: MUTED }}>{when(m.at)}{m.kind === 'opportunity' ? ' · from your follow-ups' : ''}</span></div>)}</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={600} placeholder="Write a reply…" aria-label="Reply" className="w-full rounded-[12px] border px-3 py-2 text-[14px]" style={{ borderColor: LINE }} />
        <div className="flex items-center gap-2"><button type="button" onClick={send} disabled={busy || !text.trim()} className="h-10 rounded-full px-5 text-[14px] font-semibold text-white disabled:opacity-50" style={{ background: INK }}>{busy ? 'Sending…' : 'Send'}</button>
          <span className="text-[12px]" style={{ color: MUTED }}>Goes from the studio’s number, signed with your business name.</span></div>
        {err && <p className="text-[13px] font-semibold" style={{ color: RED }}>{err}</p>}
      </div>}
    </section>);
}
