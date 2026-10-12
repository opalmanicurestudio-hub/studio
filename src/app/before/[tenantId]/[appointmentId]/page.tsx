'use client';
// src/app/before/[tenantId]/[appointmentId]/page.tsx — BEFORE YOUR VISIT (approved design, canvas row 25). The client's
// few quick questions, with the effect shown as they tap (time and price, from the business's own services and add-ons),
// then "Here's your visit now" and "Good to know" before they agree. A safety answer stops here: the team calls, and
// moving the visit is free. Opened from the text sent before the visit (?k=) or their visit link (?t=) — /api/prep-check.
import { topUpDue, centsLabel } from '@/lib/prep-topup';
import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { quoteFor, type Answers } from '@/lib/prep-check';
import { shrink } from '@/components/making-it-right/VoiceNote';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', AMBER = '#b45309', GREEN = '#1f7a4d', RED = '#b42318';
const money = (n: number) => `$${Number.isInteger(Math.round(n * 100) / 100) ? Math.round(n) : (Math.round(n * 100) / 100).toFixed(2)}`;
const font: React.CSSProperties = { fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', color: INK, letterSpacing: '-0.01em' };

export default function BeforeYourVisit() {
  const { tenantId, appointmentId } = useParams<{ tenantId: string; appointmentId: string }>(); const sp = useSearchParams();
  const auth = { tenantId, appointmentId, k: sp.get('k') || undefined, t: sp.get('t') || undefined, d: sp.get('d') || undefined };
  const post = React.useCallback((body: any) => fetch('/api/prep-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...auth, ...body }) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'No connection — try again.' })), [tenantId, appointmentId, sp]); // eslint-disable-line react-hooks/exhaustive-deps
  const [info, setInfo] = React.useState<any>(null); const [answers, setAnswers] = React.useState<Answers>({});
  const [step, setStep] = React.useState<'ask' | 'review' | 'done' | 'question' | 'asked' | 'safety'>('ask');
  const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState(''); const [text, setText] = React.useState('');
  React.useEffect(() => { post({ action: 'get' }).then((r) => { setInfo(r); if (r?.prep?.answers) setAnswers(r.prep.answers); if (['agreed', 'approved', 'kept'].includes(r?.prep?.status)) setStep('done'); if (r?.prep?.status === 'safety') setStep('safety'); }); }, [post]);
  const shell = (body: React.ReactNode, foot?: React.ReactNode) => <div style={{ ...font, background: '#fff', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ maxWidth: 520, width: '100%', margin: '0 auto', padding: '22px 20px 24px', display: 'flex', flexDirection: 'column', gap: 18, flex: 1 }}>
      {info?.brand && <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{info.brand.logo ? <img src={info.brand.logo} alt="" style={{ width: 34, height: 34, borderRadius: 11, objectFit: 'cover' }} /> : <span style={{ width: 34, height: 34, borderRadius: 11, background: INK, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>{String(info.brand.name).slice(0, 1)}</span>}<span style={{ fontSize: 14, fontWeight: 600 }}>{info.brand.name}</span></div>}
      {info?.desk && <div style={{ padding: '10px 14px', borderRadius: 14, background: '#e6ecf7', color: '#22365f', fontSize: 13.5, lineHeight: 1.45 }}><b>Filling this in over the phone.</b> Read each question to {info.visit?.clientFirst || 'them'}. Before “Looks right”, read them the change and the price — their yes is recorded as taken by phone.</div>}
      {body}</div>
    {foot && <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: `1px solid ${LINE}` }}><div style={{ maxWidth: 520, margin: '0 auto', padding: '12px 16px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>{foot}</div></div>}
  </div>;
  if (!info) return shell(<p style={{ color: MUTED }}>Loading…</p>);
  if (!info.ok) return shell(<div><p style={{ fontSize: 20 }}>{info.error || 'This link isn’t valid.'}</p><p style={{ color: MUTED }}>Use the link in your message, or reply to it.</p></div>);
  const head = (title: string) => <div><div style={{ fontSize: 13, color: MUTED }}>Before your {info.visit.service.toLowerCase()} · {info.visit.when}{info.visit.provider ? ` with ${info.visit.provider}` : ''}</div><div style={{ fontSize: 28, fontWeight: 400, letterSpacing: '-.03em', lineHeight: 1.15 }}>{title}</div></div>;
  if (info.closed) return shell(<>{head('This visit is past')}<p style={{ color: MUTED, fontSize: 15 }}>There’s nothing to answer now. Thank you!</p></>);
  if (!info.check) return shell(<>{head('Nothing to answer')}<p style={{ color: MUTED, fontSize: 15 }}>We don’t need anything before this visit. See you then!</p></>);
  const qs: any[] = info.check.questions;
  const thisService = info.catalog.find((x: any) => x.id === info.serviceId) || null;
  const q = quoteFor(info.check, thisService, info.catalog, answers, info.booked);
  const word = info.settings.quote === 'about' ? 'About' : 'Up to';
  const choiceQs = qs.filter((x) => x.kind === 'choice'); const allChoice = choiceQs.every((x) => answers[x.id]);
  const save = async (next: 'review' | 'safety') => { setBusy('save'); setErr(''); const r = await post({ action: 'answer', answers }); setBusy(''); if (!r.ok) { setErr(r.error || 'That didn’t save.'); return; } setStep(r.status === 'safety' ? 'safety' : next); };

  if (step === 'safety' || q.safety) {
    if (step !== 'safety') return shell(<>{head('Thank you for telling us')}<div style={{ padding: 16, borderRadius: 16, background: '#fdecec', color: '#7a1d14', fontSize: 15, lineHeight: 1.5 }}><b style={{ display: 'block', paddingBottom: 4 }}>Let’s talk before your visit</b>{q.safety?.text}</div></>,
      <><button type="button" disabled={!!busy} onClick={() => save('safety')} style={btn(INK)}>{busy ? 'Sending…' : 'Send to the team'}</button>{err && <p style={{ color: RED, fontSize: 14 }}>{err}</p>}<button type="button" onClick={() => setAnswers((a) => { const n = { ...a }; for (const x of choiceQs) if (x.options.find((o: any) => o.id === n[x.id])?.effect?.safety) delete n[x.id]; return n; })} style={{ ...link }}>I picked the wrong answer</button></>);
    return shell(<>{head('We’ll call you')}<div style={{ padding: 16, borderRadius: 16, background: '#fdecec', color: '#7a1d14', fontSize: 15, lineHeight: 1.5 }}>{q.safety?.text || 'The team will be in touch before your visit. Moving it is free.'}</div><p style={{ color: MUTED, fontSize: 14 }}>If it’s urgent or getting worse, please see a doctor.</p></>);
  }
  if (step === 'done') return shell(<>{head('You’re all set')}<div style={{ padding: 16, borderRadius: 16, background: '#e9f3ed', color: '#1f5a3a', fontSize: 15, lineHeight: 1.5 }}><b>Thank you!</b> {info.prep?.status === 'approved' ? `It’s confirmed${q.changed ? ` — ${word.toLowerCase()} ${money(q.newPrice)}` : ''}.` : info.prep?.status === 'kept' ? 'We’re keeping your visit as booked.' : `${info.visit.provider || 'Your provider'} will confirm${q.changed ? ` — ${word.toLowerCase()} ${money(q.newPrice)}` : ''}.`} You only pay for what you agree to.</div>
    {info.topUp && <TopUp t={info.topUp} paidNow={sp.get('paid') === '1'} pay={async () => { const r = await post({ action: 'topup' }); if (r.ok && r.url) window.location.href = r.url; else setErr(r.error || 'That didn’t work.'); }} />}
    {err && <p style={{ color: RED, fontSize: 14 }}>{err}</p>}
    {q.changed && <Summary q={q} word={word} deposit={info.deposit} moreNote={info.topUp ? (info.topUp.status === 'paid' ? 'Topped up — thank you' : 'Add it above') : undefined} more={info.topUp ? (info.topUp.status === 'paid' || sp.get('paid') === '1' ? 0 : info.topUp.cents) : info.prep?.status === 'approved' ? 0 : topUpDue(info.settings.topUp || { mode: 'off', overCents: 0, pct: 0 }, { depositStatus: info.depositPaidCents ? 'paid' : '', depositAmountCents: info.depositPaidCents }, q.oldPrice, q.newPrice)} />}
    {!info.locked && !['approved', 'kept'].includes(info.prep?.status) && <button type="button" onClick={() => setStep('ask')} style={link}>Change my answers</button>}</>);
  if (step === 'question' || step === 'asked') return shell(<>{head(step === 'asked' ? 'We’ll get back to you' : 'Ask us anything')}
    {step === 'asked' ? <p style={{ color: MUTED, fontSize: 15 }}>The team has your question and your answers. Nothing changes until you’ve agreed.</p>
      : <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={600} placeholder="Type your question" aria-label="Your question" style={{ width: '100%', borderRadius: 16, border: `1px solid ${LINE}`, padding: 14, font: 'inherit', fontSize: 15.5 }} />}</>,
    step === 'asked' ? undefined : <><button type="button" disabled={!!busy || !text.trim()} onClick={async () => { setBusy('q'); const r = await post({ action: 'question', text }); setBusy(''); if (r.ok) setStep('asked'); else setErr(r.error || 'That didn’t send.'); }} style={btn(INK)}>{busy ? 'Sending…' : 'Send'}</button>{err && <p style={{ color: RED, fontSize: 14 }}>{err}</p>}<button type="button" onClick={() => setStep('review')} style={link}>Back</button></>);
  if (step === 'review') return shell(<>{head('Here’s your visit now')}
    <Summary q={q} word={word} deposit={info.deposit} more={topUpDue(info.settings.topUp || { mode: 'off', overCents: 0, pct: 0 }, { depositStatus: info.depositPaidCents ? 'paid' : '', depositAmountCents: info.depositPaidCents }, q.oldPrice, q.newPrice)} />
    <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5, margin: 0 }}>You only pay for what you agree to. Nothing changes on your booking until {info.visit.provider || 'we'} confirm{info.visit.provider ? 's' : ''}.</p>
    {info.goodToKnow?.length > 0 && <div style={{ padding: 14, borderRadius: 16, background: SOFT }}><div style={{ fontSize: 14.5, fontWeight: 700, paddingBottom: 4 }}>Good to know</div>{info.goodToKnow.map((g: string, i: number) => <div key={i} style={{ display: 'flex', gap: 9, padding: '5px 0', fontSize: 14, lineHeight: 1.45 }}><span style={{ color: MUTED }}>•</span><span>{g}</span></div>)}</div>}
    {info.locked && <p style={{ fontSize: 14, color: AMBER }}>Your visit is soon — {info.visit.provider || 'your provider'} will go over this with you when you arrive.</p>}</>,
    <><div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 8 }}><button type="button" onClick={() => setStep('question')} style={btnW}>I have a question</button>
      <button type="button" disabled={!!busy} onClick={async () => { setBusy('agree'); const r = await post({ action: 'agree' }); setBusy(''); if (r.ok) setStep('done'); else setErr(r.error || 'That didn’t save.'); }} style={btn(INK)}>{busy ? 'Saving…' : 'Looks right'}</button></div>
      {err && <p style={{ color: RED, fontSize: 14 }}>{err}</p>}<button type="button" onClick={() => setStep('ask')} style={link}>Change my answers</button></>);

  // The questions
  return shell(<>{head(qs.length === 1 ? 'One quick question, so we save the right time' : `${['', 'One', 'Two', 'Three', 'Four', 'Five'][qs.length] || qs.length} quick questions, so we save the right time`)}
    {qs.map((x: any, i: number) => <div key={x.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div><div style={{ fontSize: 12, color: MUTED }}>{i + 1} of {qs.length}</div><div style={{ fontSize: 17, fontWeight: 600 }}>{x.label}</div>{x.help && <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>{x.help}</div>}</div>
      {x.kind === 'photo' ? <Photo url={answers[x.id]} onUpload={async (f) => { const r = await post({ action: 'photo', dataUrl: await shrink(f) }); if (r.ok) setAnswers((a) => ({ ...a, [x.id]: r.url })); else setErr(r.error || 'That didn’t upload.'); }} onClear={() => setAnswers((a) => { const n = { ...a }; delete n[x.id]; return n; })} />
        : <div role="radiogroup" aria-label={x.label} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{x.options.map((o: any) => { const on = answers[x.id] === o.id;
          return <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => setAnswers((a) => ({ ...a, [x.id]: o.id }))} style={{ height: 46, padding: '0 18px', borderRadius: 23, border: 0, font: 'inherit', fontSize: 15.5, fontWeight: 600, background: on ? INK : SOFT, color: on ? '#fff' : INK }}>{o.label}</button>; })}</div>}
    </div>)}</>,
    <><div aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 14, background: q.changed ? '#fdf3e6' : SOFT, color: q.changed ? '#7a3e05' : INK }}>
        <span style={{ flex: 1, fontSize: 14 }}>{q.changed ? <><b>So far:</b> {q.lines.join(' · ')}</> : 'So far: no change'}</span><b style={{ fontSize: 16 }}>{q.newPrice - q.oldPrice > 0 ? `+${money(q.newPrice - q.oldPrice)}` : q.newPrice < q.oldPrice ? `−${money(q.oldPrice - q.newPrice)}` : ''}</b></div>
      <button type="button" disabled={!allChoice || !!busy} onClick={() => save('review')} style={{ ...btn(INK), opacity: allChoice ? 1 : 0.45 }}>{busy ? 'Saving…' : allChoice ? 'See what changes' : 'Answer the questions above'}</button>
      {err && <p style={{ color: RED, fontSize: 14, margin: 0 }}>{err}</p>}</>);
}

const btn = (bg: string): React.CSSProperties => ({ height: 52, borderRadius: 26, border: 0, background: bg, color: '#fff', font: 'inherit', fontSize: 15.5, fontWeight: 600, width: '100%' });
const btnW: React.CSSProperties = { height: 52, borderRadius: 26, border: `1px solid ${LINE}`, background: '#fff', font: 'inherit', fontSize: 15, fontWeight: 500 };
const link: React.CSSProperties = { background: 'none', border: 0, font: 'inherit', fontSize: 14, color: MUTED, textDecoration: 'underline', textUnderlineOffset: 3, alignSelf: 'center' };

function Summary({ q, word, deposit, more = 0, moreNote }: { q: any; word: string; deposit: string | null; more?: number; moreNote?: string }) {
  const row = (a: string, b: React.ReactNode, c: React.ReactNode, hi = false) => <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr auto', gap: 10, alignItems: 'baseline', padding: '12px 0', borderTop: `1px solid ${LINE}`, fontSize: 15 }}><span style={{ color: MUTED, fontSize: 13 }}>{a}</span><span>{b}</span><b style={{ color: hi ? AMBER : INK }}>{c}</b></div>;
  const dm = q.newMinutes - q.oldMinutes; const dp = q.newPrice - q.oldPrice;
  return <div style={{ border: `1px solid ${LINE}`, borderRadius: 18, padding: '2px 16px 6px' }}>
    {row('Service', <>{q.serviceName}{q.addOns.length ? <span style={{ color: MUTED }}> + {q.addOns.map((a: any) => (a.qty > 1 ? `${a.name} × ${a.qty}` : a.name)).join(', ')}</span> : null}</>, q.switched || q.addOns.length ? 'Updated' : 'No change', q.switched || q.addOns.length > 0)}
    {row('Time', `About ${q.newMinutes} min`, dm ? `${dm > 0 ? '+' : '−'}${Math.abs(dm)} min` : 'No change', !!dm)}
    {row(word, dp ? <><s style={{ color: MUTED }}>{money(q.oldPrice)}</s>&nbsp; {money(q.newPrice)}</> : money(q.newPrice), dp ? `${dp > 0 ? '+' : '−'}${money(Math.abs(dp))}` : 'No change', !!dp)}
    {deposit && row('Deposit', more ? <>{deposit}<span style={{ display: 'block', color: MUTED, fontSize: 13 }}>{moreNote || 'Goes up with the price once it’s confirmed'}</span></> : deposit, more ? `+${centsLabel(more)}` : 'No change', more > 0)}
  </div>;
}

function TopUp({ t, paidNow, pay }: { t: { cents: number; status: string }; paidNow: boolean; pay: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  if (t.status === 'paid' || paidNow) return <div style={{ padding: 14, borderRadius: 16, background: '#e9f3ed', color: '#1f5a3a', fontSize: 15 }}>Deposit topped up by {centsLabel(t.cents)} — thank you. It comes off your total at your visit.</div>;
  return <div style={{ padding: 16, borderRadius: 18, border: `1px solid ${LINE}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div style={{ fontSize: 16 }}><b>Your deposit goes up by {centsLabel(t.cents)}</b></div>
    <div style={{ fontSize: 14, color: MUTED, lineHeight: 1.45 }}>The price went up, so the deposit does too. It comes off your total at your visit.</div>
    <button type="button" disabled={busy} onClick={async () => { setBusy(true); await pay(); setBusy(false); }} style={btn(INK)}>{busy ? 'Opening…' : `Add ${centsLabel(t.cents)} by card`}</button>
  </div>;
}

function Photo({ url, onUpload, onClear }: { url?: string; onUpload: (f: File) => Promise<void>; onClear: () => void }) {
  const [busy, setBusy] = React.useState(false);
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    {url ? <><img src={url} alt="Your photo" style={{ width: 84, height: 84, borderRadius: 14, objectFit: 'cover' }} /><button type="button" onClick={onClear} style={link}>Remove</button></>
      : <label style={{ width: 84, height: 84, borderRadius: 14, border: '1.5px dashed #c9cacf', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: MUTED, cursor: 'pointer', textAlign: 'center' }}>{busy ? 'Adding…' : 'Add a photo'}
        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setBusy(true); await onUpload(f); setBusy(false); }} /></label>}
  </div>;
}
