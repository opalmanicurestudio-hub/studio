'use client';
// src/app/(app)/import/tell/page.tsx — MOVING IN → TELL YOUR CLIENTS (/api/import/tell). Write the switch-over text, see
// who gets it by text and who by email, send yourself a test, and schedule it for switch-over day (or send it now).
// Each person's {link} is their own welcome page: their history came over, their next visit is booked, their usual is one tap.
import * as React from 'react';
import { useTenant } from '@/context/TenantContext';
import { AppHeader } from '@/components/shared/AppHeader';
import { payPost } from '@/components/pay/pay-client';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318';
const card = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18 } as const;
// Texts are billed per 153-character part (67 when there's an emoji) — same count as the campaign engine.
function segmentsFor(text: string) { const gsm = /^[\n\r\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€^{}\\\[~\]|]*$/.test(text); const per = gsm ? (text.length <= 160 ? 160 : 153) : (text.length <= 70 ? 70 : 67); return Math.max(1, Math.ceil(text.length / per)); }
const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function TellClientsPage() {
  const { selectedTenant, role } = useTenant() as any; const tenantId = selectedTenant?.id || '';
  const isManager = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [d, setD] = React.useState<any>(null); const [body, setBody] = React.useState(''); const [day, setDay] = React.useState(''); const [time, setTime] = React.useState('11:00');
  const [busy, setBusy] = React.useState<string | null>(null); const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null); const [to, setTo] = React.useState('');
  const load = React.useCallback(() => { if (tenantId && isManager) payPost('/api/import/tell', { tenantId, action: 'preview' }).then((r) => { if (!r.ok) return; setD(r);
    setBody((b) => b || r.scheduled?.body || r.body); const at = r.scheduled?.at ? new Date(r.scheduled.at) : null;
    setDay((x) => x || (at ? localDay(at) : r.switchDate || localDay(new Date(Date.now() + 864e5)))); if (at) setTime(`${pad(at.getHours())}:${pad(at.getMinutes())}`); }); }, [tenantId, isManager]);
  React.useEffect(() => { load(); }, [load]);
  if (!isManager) return <div className="p-6"><AppHeader title="Tell your clients" /><p className="mt-6" style={{ color: MUTED }}>This is for managers.</p></div>;
  const biz = selectedTenant?.name || 'Your studio';
  const sample = body.replace(/\{first\}/g, 'Maria').replace(/\{business\}/g, biz).replace(/\{link\}/g, `${typeof window !== 'undefined' ? window.location.host : ''}/hello/…`);
  const full = `${biz}: ${sample}\nReply STOP to opt out.`; const segs = segmentsFor(full);
  const when = day ? new Date(`${day}T${time || '11:00'}:00`) : null; const hr = when ? when.getHours() + when.getMinutes() / 60 : 12;
  const odd = when && (hr < 9 || hr >= 20);
  const sched = d?.scheduled; const gone = sched && (['sending', 'sent'].includes(sched.sms?.status) || ['sending', 'sent'].includes(sched.email?.status));
  const act = async (action: string, extra: any = {}) => { setBusy(action); setMsg(null); const r = await payPost('/api/import/tell', { tenantId, action, body, ...extra }); setBusy(null);
    if (!r.ok) { setMsg({ ok: false, t: r.error || 'That didn’t work.' }); return; }
    setMsg({ ok: true, t: action === 'test' ? `Test sent to ${r.to}.` : action === 'cancel' ? 'Taken back — nothing was sent.' : r.started ? `Going out now — ${r.sms} by text, ${r.email} by email.` : `Scheduled for ${new Date(r.sendAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} — ${r.sms} by text, ${r.email} by email.` }); load(); };
  return (
    <div className="min-h-screen" style={{ color: INK, backgroundColor: '#f7f7f8', backgroundImage: 'radial-gradient(120% 80% at 8% -5%, #e5e5ec 0%, transparent 55%)' }}>
      <AppHeader title="Tell your clients" />
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-6 p-4 md:p-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-4">
          <div><p className="text-[13px]" style={{ color: MUTED }}><a href="/import" className="underline-offset-4 hover:underline">Moving in</a> › Tell your clients</p>
            <h1 className="text-[36px] font-normal tracking-[-0.03em]">Tell your clients</h1></div>
          <label className="block"><span className="mb-1.5 block text-[13px]" style={{ color: MUTED }}>The message</span>
            <textarea disabled={!!gone} value={body} onChange={(e) => setBody(e.target.value.slice(0, 480))} rows={4} className="w-full rounded-[18px] border bg-white px-4 py-3.5 text-[15.5px] leading-relaxed outline-none focus:ring-2 focus:ring-black/10" style={{ borderColor: LINE }} />
            <span className="mt-1 block text-[12.5px]" style={{ color: body.includes('{link}') ? MUTED : RED }}>{full.length} characters · {segs} text{segs === 1 ? '' : 's'} each · {'{first}'} is their first name, {'{link}'} their own booking page{body.includes('{link}') ? '' : ' — put {link} back in'}</span></label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[[d?.sms, 'said yes to texts — they get the text'], [d?.email, 'didn’t, but have an email — they get an email'], [d?.none, 'can’t be reached, or unsubscribed']].map(([n, l], i) => (
              <div key={i} className="p-4" style={card}><p className="text-[28px] font-normal tracking-[-0.03em]">{n == null ? '—' : Number(n).toLocaleString()}</p><p className="text-[13px]" style={{ color: MUTED }}>{l}</p></div>))}
          </div>
          {d && !d.textsReady && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: '#fdf3e6', color: AMBER }}>Texting isn’t set up yet, so everyone with an email gets it by email.</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4" style={card}>
            <div><p className="text-[15px] font-semibold">When</p><p className="text-[13px]" style={{ color: odd ? AMBER : MUTED }}>{when ? when.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Choose a day'}{odd ? ' — texts wait until 9am their time' : ' — not too early, not at night'}</p></div>
            <div className="flex gap-2"><input disabled={!!gone} type="date" value={day} min={localDay(new Date())} onChange={(e) => setDay(e.target.value)} aria-label="Day" className="h-11 rounded-xl border bg-white px-3 text-[14.5px]" style={{ borderColor: LINE }} />
              <input disabled={!!gone} type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" className="h-11 rounded-xl border bg-white px-3 text-[14.5px]" style={{ borderColor: LINE }} /></div>
          </div>
          {msg && <p className="text-[14px] font-semibold" style={{ color: msg.ok ? GREEN : RED }} role="status">{msg.t}</p>}
          {gone ? <p className="rounded-2xl px-4 py-3 text-[14.5px]" style={{ background: '#e9f3ed', color: GREEN }}>It’s gone out — {(sched.sms?.sent || 0) + (sched.email?.sent || 0)} sent so far. See how it did in <a href="/campaigns" className="font-semibold underline underline-offset-4">Campaigns</a>.</p> : <>
            <div className="flex flex-wrap gap-2">
              <input value={to} onChange={(e) => setTo(e.target.value)} inputMode="tel" placeholder="Your mobile (for a test)" aria-label="Your mobile for a test" className="h-12 w-[200px] rounded-full border bg-white px-4 text-[14.5px]" style={{ borderColor: LINE }} />
              <button type="button" disabled={!!busy || !body.includes('{link}')} onClick={() => act('test', { to })} className="h-12 rounded-full border bg-white px-5 text-[14.5px] font-semibold disabled:opacity-40" style={{ borderColor: LINE }}>{busy === 'test' ? 'Sending…' : 'Send me a test'}</button>
              <button type="button" disabled={!!busy || !when || !body.includes('{link}') || (!d?.sms && !d?.email)} onClick={() => act('schedule', { sendAt: when!.toISOString() })} className="h-12 flex-1 rounded-full px-5 text-[14.5px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{busy === 'schedule' ? 'Scheduling…' : sched ? `Change it to ${when?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : `Schedule for ${when ? when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '…'}`}</button>
            </div>
            <div className="flex flex-wrap gap-4 text-[13.5px]"><button type="button" disabled={!!busy || !body.includes('{link}')} onClick={() => { if (window.confirm(`Send it now to ${d?.sms || 0} by text and ${d?.email || 0} by email?`)) act('schedule', { now: true }); }} className="font-semibold underline underline-offset-4">Send it now instead</button>
              {sched && <button type="button" disabled={!!busy} onClick={() => act('cancel')} className="underline underline-offset-4" style={{ color: MUTED }}>Take it back</button>}</div></>}
          <p className="text-[12.5px] leading-relaxed" style={{ color: MUTED }}>Only people who said yes to texts — in your old app or here — get a text. Nobody who unsubscribed hears from you. Texts go out 9am to 8pm, in small batches so phone companies don’t block them.</p>
        </div>
        <div className="flex justify-center lg:justify-end"><div className="w-full max-w-[360px] rounded-[44px] border-[8px] bg-white" style={{ borderColor: '#16171a', minHeight: 620 }}>
          <p className="border-b py-3 text-center text-[13px]" style={{ borderColor: LINE, color: MUTED, background: '#f7f7f8', borderRadius: '36px 36px 0 0' }}>{biz}</p>
          <div className="space-y-2 p-4"><div className="max-w-[88%] whitespace-pre-wrap rounded-[18px] px-3.5 py-2.5 text-[14.5px] leading-snug" style={{ background: '#e9e9eb' }}>{full}</div>
            <div className="max-w-[78%] overflow-hidden rounded-[16px] border" style={{ borderColor: LINE }}><div className="px-4 py-4 text-white" style={{ background: selectedTenant?.brandColor || selectedTenant?.bookingPageSettings?.primaryColor || '#7c3aed' }}><p className="text-[12px] font-semibold opacity-90">{biz}</p><p className="mt-1 text-[18px] leading-tight">Welcome back, Maria</p></div>
              <p className="px-3 py-2 text-[12px]" style={{ color: MUTED }}>Your history, your next visit, book again</p></div></div></div></div>
      </main>
    </div>);
}
