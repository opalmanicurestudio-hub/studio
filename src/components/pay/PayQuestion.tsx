'use client';
// src/components/pay/PayQuestion.tsx — "SOMETHING'S OFF" for staff: the sheet that points at a stub line and says what
// looks wrong (PayQuestionSheet), and where it's at afterwards — sent, seen, checking, sorted — with the conversation
// (PayQuestionStatus). Managers settle them in the main app (Pay questions).
import * as React from 'react';
import { money, dshort, payPost } from '@/components/pay/pay-client';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const REASONS: [string, string][] = [['visit_missing', 'A visit is missing'], ['tip_missing', 'A tip is missing'], ['wrong_price', 'Wrong price or rate'], ['hours_wrong', 'Hours are wrong'], ['other', 'Something else']];
const guess = (l: any) => !l ? '' : l.kind === 'tip' ? 'tip_missing' : l.kind === 'shift' ? 'hours_wrong' : l.kind === 'visit' || l.kind === 'retail' ? 'wrong_price' : '';

export function PayQuestionSheet({ tenantId, stub, line, accent = INK, onClose }: { tenantId: string; stub: any; line: any | null; accent?: string; onClose: (sent: boolean) => void }) {
  const [reason, setReason] = React.useState(guess(line)); const [note, setNote] = React.useState(''); const [hint, setHint] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const send = async () => {
    if (!reason) { setErr('Pick what looks wrong.'); return; }
    if (!line && !note.trim() && !hint.trim()) { setErr('Tell your manager which visit, day or amount.'); return; }
    setBusy(true); setErr('');
    const r = await payPost('/api/pay/questions', { tenantId, action: 'ask', periodFrom: stub.period.from, periodTo: stub.period.to, reason, note, visitHint: hint,
      line: line ? { ref: line.ref, title: line.title, amount: line.amount, date: line.date, source: line.source || null } : { ref: '', title: `${dshort(stub.period.from)} – ${dshort(stub.period.to)} stub`, amount: stub.total } });
    setBusy(false); if (r.ok) onClose(true); else setErr(r.error || 'That didn’t send.');
  };
  return (
    <div className="space-y-4" style={{ color: INK }}>
      <div className="flex items-center gap-2.5"><button type="button" onClick={() => onClose(false)} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: '#f4f4f5' }}>Cancel</button><p className="text-[20px] font-extrabold">What looks wrong?</p></div>
      <div className="flex justify-between rounded-[14px] px-3.5 py-3 text-[14px]" style={{ background: '#f6f6f7' }}><span className="min-w-0 truncate">{line ? `${line.date ? `${dshort(line.date)} · ` : ''}${line.title}` : `The whole stub · ${dshort(stub.period.from)} – ${dshort(stub.period.to)}`}</span><span className="pl-2 font-bold">{line?.kind === 'shift' ? '' : money(line ? line.amount : stub.total)}</span></div>
      <div role="radiogroup" aria-label="What looks wrong" className="grid grid-cols-2 gap-2">
        {REASONS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={reason === k} onClick={() => setReason(k)} className="min-h-[46px] rounded-[14px] px-2 text-[14px]" style={reason === k ? { border: `2px solid ${accent}`, background: `${accent}10`, fontWeight: 700 } : { border: '1px solid #e6e6e8', fontWeight: 600 }}>{l}</button>)}
      </div>
      {(!line || reason === 'visit_missing' || reason === 'tip_missing') && <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Which visit or day?
        <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. Kim, Sat Sep 26, gel manicure" className="mt-1.5 h-12 w-full rounded-[14px] border px-3 text-[15px]" style={{ borderColor: '#e6e6e8', color: INK }} /></label>}
      <label className="block text-[13px] font-semibold" style={{ color: MUTED }}>Anything else? {line ? '(optional)' : ''}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="e.g. She tipped $20 cash at the desk — I don’t see it." className="mt-1.5 w-full rounded-[14px] border px-3 py-2.5 text-[15px]" style={{ borderColor: '#e6e6e8', color: INK }} /></label>
      {err && <p role="alert" className="text-[13px] font-medium" style={{ color: '#b42318' }}>{err}</p>}
      <button type="button" disabled={busy} onClick={send} className="h-12 w-full rounded-[16px] text-[16px] font-bold text-white disabled:opacity-50" style={{ background: INK }}>{busy ? 'Sending…' : 'Send to my manager'}</button>
      <p className="text-center text-[12px]" style={{ color: MUTED }}>Only you and managers see it. Paid stubs don’t change — a fix goes on your next pay.</p>
    </div>);
}

const STEPS = [['open', 'Sent'], ['checking', 'Your manager is checking'], ['done', 'Sorted']] as const;
export function PayQuestionStatus({ tenantId, question: q, accent = INK, onBack }: { tenantId: string; question: any; accent?: string; onBack: () => void }) {
  const [text, setText] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  if (!q) return <div className="space-y-3"><button type="button" onClick={onBack} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: '#f4f4f5' }}>Back</button><p style={{ color: MUTED }}>That question isn’t available.</p></div>;
  const done = q.status === 'sorted' || q.status === 'explained'; const at = done ? 2 : q.status === 'checking' ? 1 : 0;
  const reply = async () => { if (!text.trim()) return; setBusy(true); setErr(''); const r = await payPost('/api/pay/questions', { tenantId, action: 'reply', id: q.id, note: text }); setBusy(false); if (r.ok) setText(''); else setErr(r.error || 'That didn’t send.'); };
  const res = q.resolution; const when = (iso: string) => iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  return (
    <div className="space-y-4" style={{ color: INK }}>
      <div className="flex items-center gap-2.5"><button type="button" onClick={onBack} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: '#f4f4f5' }}>Back</button><p className="text-[20px] font-extrabold">Your pay question</p></div>
      <div className="space-y-1 rounded-[20px] p-3.5" style={{ background: done ? `${accent}12` : '#fdf6ea' }}>
        <p className="text-[13px] font-bold" style={{ color: done ? accent : '#9a5b00' }}>{done ? (res?.kind === 'adjust' ? `Sorted — ${money((res.amountCents || 0) / 100)} ${res.amountCents > 0 ? 'added to' : 'taken off'} your current pay` : res?.kind === 'fixed' ? 'Sorted — the record was corrected' : 'Answered') : q.status === 'checking' ? `${q.seenBy ? String(q.seenBy).split(' ')[0] : 'Your manager'} is checking` : 'Waiting for your manager · usually within 2 days'}</p>
        <p className="text-[15px] font-bold">{q.reasonLabel}{q.line?.title ? ` — ${q.line.title}` : ''}</p>
        {q.visitHint && <p className="text-[14px]" style={{ color: '#55585e' }}>{q.visitHint}</p>}
      </div>
      <ol aria-label="Progress" className="space-y-0">
        {STEPS.map(([k, label], i) => { const ok = i <= at; return (
          <li key={k} className="flex gap-3"><div className="flex flex-col items-center"><span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white" style={ok ? { background: accent } : { border: '2px solid #d9dadd' }}>{ok ? '✓' : ''}</span>{i < 2 && <span className="w-0.5 flex-1" style={{ minHeight: 22, background: LINE }} />}</div>
            <div className="pb-3"><p className="text-[15px] font-bold" style={{ color: ok ? INK : '#9a9ca1' }}>{label}</p><p className="text-[13px]" style={{ color: MUTED }}>{i === 0 ? when(q.createdAt) : i === 1 ? when(q.seenAt) : done ? when(res?.at) : 'You’ll get a notification'}</p></div></li>); })}
      </ol>
      <section aria-label="Messages" className="space-y-2 rounded-[18px] border p-3.5" style={{ borderColor: LINE }}>
        <p className="text-[13px] font-bold">Messages</p>
        {(q.messages || []).map((m: any, i: number) => { const me = m.by === q.staffId; return <p key={i} className={`max-w-[85%] rounded-[16px] px-3 py-2 text-[14px] ${me ? 'ml-auto text-white' : ''}`} style={me ? { background: accent, borderBottomRightRadius: 6 } : { background: '#f4f4f5', borderBottomLeftRadius: 6 }}>{m.text}</p>; })}
        {res?.note && !(q.messages || []).some((m: any) => m.text === res.note) && <p className="max-w-[85%] rounded-[16px] px-3 py-2 text-[14px]" style={{ background: '#f4f4f5' }}>{res.note}</p>}
        <div className="flex gap-2"><input value={text} onChange={(e) => setText(e.target.value)} aria-label="Reply" placeholder="Reply" className="h-11 min-w-0 flex-1 rounded-full border px-4 text-[15px]" style={{ borderColor: '#e6e6e8' }} />
          <button type="button" disabled={busy || !text.trim()} onClick={reply} className="h-11 rounded-full px-4 text-[14px] font-bold text-white disabled:opacity-40" style={{ background: INK }}>Send</button></div>
        {err && <p role="alert" className="text-[13px]" style={{ color: '#b42318' }}>{err}</p>}
      </section>
    </div>);
}
