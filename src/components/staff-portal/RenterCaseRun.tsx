'use client';
// src/components/staff-portal/RenterCaseRun.tsx — A RENTER RUNS THEIR OWN CASE (lib/renter-cases). In the staff app's
// Client cases: reply to the client (texted), choose the fix they offer (a free fix booked in their own planner, a refund
// from their own payments, or a note), record the fix's time, mark it done, record "did we make it right?" and close.
// Plus their own Making it right settings — what clients can choose, the redo window, what they offer.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';

const MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f6';
const btn = 'h-12 w-full rounded-2xl text-[14.5px] font-bold disabled:opacity-40';

export function RenterCaseRun({ c, tenantId, accent }: { c: any; tenantId: string; accent: string }) {
  const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState(''); const [err, setErr] = React.useState('');
  const [reply, setReply] = React.useState(''); const [kind, setKind] = React.useState<'' | 'redo' | 'refund' | 'note'>(''); const [amt, setAmt] = React.useState(''); const [when, setWhen] = React.useState(''); const [cb, setCb] = React.useState('');
  const act = async (action: string, extra: any = {}, done = 'Saved.') => { setBusy(true); setErr(''); setMsg(''); const r = await payPost('/api/cases', { tenantId, id: c.id, action, ...extra }); setBusy(false); if (r.ok) { setMsg(action === 'message' && r.sent === false ? 'Saved on the case — we couldn’t text them, so reach out directly too.' : done); return true; } setErr(r.error || 'That didn’t work.'); return false; };
  const paid = Number(c.visit?.paid || 0);
  if (c.locked) return <p className="rounded-[18px] bg-[#f5f5f6] p-4 text-[14px]">Closed{c.fix ? ` · ${c.fix.label}` : ''}.</p>;
  return <div className="space-y-3">
    <div className="rounded-[18px] border border-sky-200 bg-sky-50 p-4 text-[14px] text-sky-950"><p className="font-bold">Your client, your case.</p><p>You decide how to make it right, under your own settings. It isn’t in the salon’s case list, and only you can act on it.</p></div>
    {err && <p className="rounded-xl bg-red-50 p-3 text-[13.5px] font-semibold text-red-800">{err}</p>}
    {msg && <p className="rounded-xl bg-emerald-50 p-3 text-[13.5px] font-semibold text-emerald-800">{msg}</p>}

    {(c.messages || []).length > 0 && <div className="space-y-2">{c.messages.map((m: any, i: number) => <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[#16171a] p-3 text-[14px] text-white">{m.text}<p className="mt-1 text-[11px] text-white/60">{new Date(m.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p></div>)}</div>}
    <div className="space-y-2 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}>
      <p className="text-[15px] font-bold">Reply to {String(c.clientName || 'them').split(' ')[0]}</p>
      <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="So sorry about this — I’d love to fix it for you." className="w-full rounded-xl border p-3 text-[15px]" style={{ borderColor: LINE }} />
      <button disabled={busy || !reply.trim()} onClick={async () => { if (await act('message', { note: reply }, 'Sent.')) setReply(''); }} className={btn} style={{ background: accent, color: '#fff' }}>Send (texted to them)</button>
    </div>

    {!c.fix && <div className="space-y-2 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}>
      <p className="text-[15px] font-bold">How you’ll make it right</p>
      <div className="grid grid-cols-3 gap-2">{([['redo', 'Free fix'], ['refund', 'Refund'], ['note', 'Note it']] as const).map(([k, l]) => <button key={k} onClick={() => setKind(k)} className="h-11 rounded-xl border text-[14px] font-semibold" style={kind === k ? { background: '#16171a', color: '#fff', borderColor: '#16171a' } : { borderColor: LINE }}>{l}</button>)}</div>
      {kind === 'redo' && <p className="text-[13px]" style={{ color: MUTED }}>We’ll text them that you’ll be in touch. Book it in your planner, then add the time here.</p>}
      {kind === 'refund' && <label className="flex items-center gap-2 text-[14.5px]">Amount $<input type="number" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={paid ? paid.toFixed(2) : '0.00'} className="h-11 w-28 rounded-xl border px-3" style={{ borderColor: LINE }} /><span className="text-[12.5px]" style={{ color: MUTED }}>from your own payments</span></label>}
      {kind && <button disabled={busy || (kind === 'refund' && !(Number(amt) > 0))} onClick={() => act('choose_fix', { kind, amountCents: Math.round((Number(amt) || 0) * 100), redo: kind === 'redo' ? { mode: 'client' } : null }, kind === 'redo' ? 'Saved — we’ve texted them you’ll be in touch.' : 'Saved.')} className={btn} style={{ background: '#16171a', color: '#fff' }}>{busy ? 'Saving…' : 'Save'}</button>}
    </div>}

    {c.fix && <div className="space-y-2 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}>
      <p className="text-[15px] font-bold">{c.fix.label}{c.fix.amountCents ? ` · $${(c.fix.amountCents / 100).toFixed(2)}` : ''}</p>
      {c.fix.todo && <p className="rounded-xl p-3 text-[13.5px] font-semibold" style={{ background: '#fff7e6' }}>To do: {c.fix.todo}</p>}
      {c.fix.kind === 'redo' && (c.fix.redo?.bookedText ? <p className="text-[14px]">Booked: <b>{c.fix.redo.bookedText}</b></p> : <div className="flex gap-2"><input value={when} onChange={(e) => setWhen(e.target.value)} placeholder="e.g. Sat Oct 17, 11am" className="h-11 min-w-0 flex-1 rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} /><button disabled={busy || !when.trim()} onClick={async () => { if (await act('redo_set', { when }, 'Booked — we’ve texted them.')) setWhen(''); }} className="h-11 rounded-xl px-4 text-[14px] font-bold text-white disabled:opacity-40" style={{ background: '#16171a' }}>Add</button></div>)}
      {c.status === 'fix_chosen' && <button disabled={busy} onClick={() => act('done', {}, 'Marked done. Their page now asks if it was made right.')} className={btn} style={{ background: accent, color: '#fff' }}>It’s done</button>}
      {c.status === 'done' && <div className="space-y-2"><p className="text-[14px]">Check back: <b>did you make it right?</b></p>
        <input value={cb} onChange={(e) => setCb(e.target.value)} placeholder="What they said (optional)" className="h-11 w-full rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} />
        <div className="grid grid-cols-2 gap-2"><button disabled={busy} onClick={() => act('checked_back', { answer: 'yes', note: cb }, 'Closed. Nice work.')} className={btn} style={{ background: '#1f7a4d', color: '#fff' }}>Yes — close</button><button disabled={busy} onClick={() => act('checked_back', { answer: 'no', note: cb }, 'Reopened.')} className={btn} style={{ background: SOFT }}>Still not right</button></div></div>}
    </div>}
    {!c.fix && <button disabled={busy} onClick={() => { if (window.confirm('Close this case without a fix?')) act('close', { note: 'Closed by the renter' }, 'Closed.'); }} className="text-[13.5px] underline underline-offset-2" style={{ color: MUTED }}>Close without a fix</button>}
  </div>;
}

export function RenterMirSettings({ tenantId, accent, onBack }: { tenantId: string; accent: string; onBack: () => void }) {
  const [s, setS] = React.useState<any>(null); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState(''); const [newReason, setNewReason] = React.useState('');
  React.useEffect(() => { payPost('/api/cases', { tenantId, action: 'renter_settings' }).then((r) => { if (r.ok) setS(r.settings); else setMsg(r.error || 'Couldn’t load your settings.'); }); }, [tenantId]);
  const save = async () => { setBusy(true); setMsg(''); const r = await payPost('/api/cases', { tenantId, action: 'renter_settings_save', settings: s }); setBusy(false); if (r.ok) { setS(r.settings); setMsg('Saved.'); } else setMsg(r.error || 'That didn’t save.'); };
  const Tog = ({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) => <button role="switch" aria-checked={on} aria-label={label} onClick={() => set(!on)} className="relative h-7 w-12 shrink-0 rounded-full" style={{ background: on ? '#16171a' : '#dcdde0' }}><span className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-all" style={{ left: on ? 23 : 3 }} /></button>;
  if (!s) return <div className="space-y-3 pt-1"><button onClick={onBack} className="text-[14px] font-semibold text-slate-500">‹ Client cases</button><p className="text-[14px]" style={{ color: MUTED }}>{msg || 'Loading…'}</p></div>;
  const row = 'flex items-center justify-between gap-3 border-t px-4 py-3.5 first:border-t-0';
  return <div className="space-y-3 pt-1">
    <button onClick={onBack} className="text-[14px] font-semibold text-slate-500">‹ Client cases</button>
    <h2 className="text-[22px] font-extrabold">Making it right — your rules</h2>
    <p className="text-[13.5px]" style={{ color: MUTED }}>For your own clients. They see these on their “How was your visit?” page.</p>
    <div className="rounded-[18px] border bg-white" style={{ borderColor: LINE }}>
      <div className={row} style={{ borderColor: LINE }}><div><p className="text-[15px] font-semibold">Free fix</p><p className="text-[12.5px]" style={{ color: MUTED }}>Book it in your planner</p></div><Tog on={!!s.fixes.redo} set={(v) => setS({ ...s, fixes: { ...s.fixes, redo: v } })} label="Free fix" /></div>
      <div className={row} style={{ borderColor: LINE }}><div><p className="text-[15px] font-semibold">Refund</p><p className="text-[12.5px]" style={{ color: MUTED }}>From your own payments</p></div><Tog on={!!s.fixes.refund} set={(v) => setS({ ...s, fixes: { ...s.fixes, refund: v } })} label="Refund" /></div>
      <div className={row} style={{ borderColor: LINE }}><p className="text-[15px] font-semibold">Clients can ask for up to</p><span className="flex items-center gap-2"><input type="number" min={1} value={s.redoWindowDays} onChange={(e) => setS({ ...s, redoWindowDays: Number(e.target.value) || 1 })} className="h-10 w-16 rounded-xl border text-center" style={{ borderColor: LINE }} /><span className="text-[13px]" style={{ color: MUTED }}>days</span></span></div>
      <div className={row} style={{ borderColor: LINE }}><div><p className="text-[15px] font-semibold">Ask for photos</p></div><Tog on={!!s.fairUse.requirePhotos} set={(v) => setS({ ...s, fairUse: { ...s.fairUse, requirePhotos: v } })} label="Ask for photos" /></div>
      <div className={row} style={{ borderColor: LINE }}><div><p className="text-[15px] font-semibold">Promise a reply within</p><p className="text-[12.5px]" style={{ color: MUTED }}>Off = they’re told you’ll be in touch</p></div><span className="flex items-center gap-2">{s.replyHours ? <input type="number" min={1} value={s.replyHours} onChange={(e) => setS({ ...s, replyHours: Number(e.target.value) || 1 })} className="h-10 w-16 rounded-xl border text-center" style={{ borderColor: LINE }} /> : null}<Tog on={!!s.replyHours} set={(v) => setS({ ...s, replyHours: v ? 24 : null })} label="Reply time" /></span></div>
    </div>
    <div className="space-y-2 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}>
      <p className="text-[15px] font-semibold">What clients can tell you</p>
      <div className="flex flex-wrap gap-2">{s.reasons.filter((r: any) => !r.safety).map((r: any) => <span key={r.id} className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-[13.5px]" style={{ background: SOFT }}>{r.label}<button aria-label={`Remove ${r.label}`} onClick={() => setS({ ...s, reasons: s.reasons.filter((x: any) => x.id !== r.id) })} className="text-[#6d7075]">×</button></span>)}</div>
      <div className="flex gap-2"><input value={newReason} onChange={(e) => setNewReason(e.target.value)} placeholder="Add one" className="h-11 min-w-0 flex-1 rounded-xl border px-3 text-[15px]" style={{ borderColor: LINE }} /><button disabled={!newReason.trim()} onClick={() => { setS({ ...s, reasons: [...s.reasons, { id: `r${Date.now().toString(36)}`, label: newReason.trim(), safety: false }] }); setNewReason(''); }} className="h-11 rounded-xl px-4 text-[14px] font-bold text-white disabled:opacity-40" style={{ background: '#16171a' }}>Add</button></div>
      <p className="text-[12px]" style={{ color: MUTED }}>Safety concerns always go to the salon’s manager as well.</p>
    </div>
    <div className="space-y-2 rounded-[18px] border bg-white p-4" style={{ borderColor: LINE }}>
      <p className="text-[15px] font-semibold">Aftercare you send</p>
      <textarea value={s.aftercare?.text || ''} onChange={(e) => setS({ ...s, aftercare: { text: e.target.value } })} rows={3} className="w-full rounded-xl border p-3 text-[15px]" style={{ borderColor: LINE }} />
    </div>
    <button disabled={busy} onClick={save} className={btn} style={{ background: accent, color: '#fff' }}>{busy ? 'Saving…' : 'Save'}</button>
    {msg && <p className="text-[13.5px] font-semibold">{msg}</p>}
  </div>;
}
