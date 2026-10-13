'use client';
// Practice a shift: the desk phone. Caller ID, two lines, hold, voicemail and callbacks, a workflow for each kind
// of call, transfers, and a short review after every call.
import { useState, type ReactNode } from 'react';
import * as R from '@/lib/practice/register';
import { Btn, Chip, Say, INK, MUTED, LINE, SOFT, GREEN, AMBER, RED, BLUE } from './parts';

const mini = { border: `1px solid ${LINE}`, background: '#fff', borderRadius: 999, padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: INK } as const;
const input = { border: `1px solid ${LINE}`, borderRadius: 10, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const, background: '#fff', color: INK };
const fmtPhone = (p: string) => p.replace(/^(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.max(0, Math.round(t)) % 60).padStart(2, '0')}`;
const first = (n: string) => n.split(' ')[0];

type Props = {
  s: R.RegState; narrow: boolean; talkEl: ReactNode; twoPlayer: boolean; excused: boolean;
  /** Call after any change: plays sounds and redraws. */
  done: () => void;
  onExcuse: () => void; onAnswer: () => void; onListen: (vm: R.Voicemail) => void; beforeAct?: () => void;
};

export function PhoneDock({ s, narrow, excused, done, onExcuse, onAnswer, onListen }: Props) {
  const [vmOpen, setVmOpen] = useState(false);
  const rg = s.ringing; const id = rg ? R.clientByPhone(s, rg.call.phone) : null; const cur = s.cur; const oc = s.onCall;
  const vmLeft = s.voicemails.filter((v) => !v.returned);
  const box = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, boxShadow: '0 12px 26px -14px rgba(0,0,0,.45)' } as const;
  return (
    <div style={{ position: 'fixed', left: narrow ? 8 : 24, right: narrow ? 8 : 'auto', top: narrow ? 112 : 122, zIndex: 43, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: narrow ? 'none' : 420 }}>
      {rg && <div style={{ ...box, padding: '8px 8px 8px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', boxShadow: '0 0 0 6px #fdf1e3, 0 12px 26px -14px rgba(0,0,0,.45)' }}>
        <span style={{ fontSize: 19, animation: 'regBeam .25s ease-in-out infinite alternate' }}>📞</span>
        <div style={{ flex: 1, minWidth: 150 }}><div style={{ fontSize: 13.5 }}><b>Line {oc || s.held.some((h) => h.line === 1) ? 2 : 1}</b> · {id ? id.name : rg.call.known ? rg.call.name : 'Unknown caller'}</div>
          <div style={{ fontSize: 11.5, color: MUTED }}>{fmtPhone(rg.call.phone)}{id ? ` · ${id.note}` : ''} · ringing {Math.round(s.t - rg.since)}s</div></div>
        {cur && !excused && !oc && <Btn small ghost onClick={onExcuse}>“Excuse me one moment”</Btn>}
        {cur && excused && !oc && <Chip tone="green">{cur.c.name} knows ✓</Chip>}
        {oc ? <Btn small onClick={() => { R.holdCall(s, true); done(); onAnswer(); }}>Ask {first(oc.call.name)} to hold, answer</Btn> : <Btn small onClick={onAnswer}>Answer</Btn>}
      </div>}
      {s.held.map((h) => { const t = s.t - h.hold!.since; const warn = t > R.HOLD_WARN;
        return <div key={h.call.id} style={{ ...box, padding: '8px 8px 8px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', boxShadow: warn ? '0 0 0 6px #fdecec, 0 12px 26px -14px rgba(0,0,0,.45)' : box.boxShadow }}>
          <span style={{ fontSize: 16 }}>⏸</span>
          <div style={{ flex: 1, minWidth: 140 }}><div style={{ fontSize: 13 }}><b>Line {h.line}</b> · {h.call.name} on hold · {mmss(t)}</div>
            <div style={{ height: 4, background: SOFT, borderRadius: 2, marginTop: 4, overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(100, (t / R.HOLD_LIMIT) * 100)}%`, background: warn ? RED : AMBER }} /></div>
            {warn && <div style={{ fontSize: 11.5, color: RED, fontWeight: 600, marginTop: 3 }}>Check back now, or they’ll hang up.</div>}</div>
          <button style={mini} onClick={() => { R.checkBack(s, h.call.id); done(); }}>“Thanks for holding”</button>
          <Btn small onClick={() => { if (s.onCall) R.holdCall(s, true); R.resumeCall(s, h.call.id); done(); }}>{s.onCall ? `Switch to ${first(h.call.name)}` : `Back to ${first(h.call.name)}`}</Btn>
        </div>; })}
      {s.voicemails.length > 0 && <div style={{ alignSelf: 'flex-start' }}>
        <button onClick={() => setVmOpen((v) => !v)} style={{ ...mini, background: vmLeft.length ? '#fff7ed' : '#fff', borderColor: vmLeft.length ? '#f5d0a9' : LINE }}>📼 Voicemail{vmLeft.length ? ` · ${vmLeft.length} to call back` : ' · all returned'}</button>
        {vmOpen && <div style={{ ...box, marginTop: 6, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, width: narrow ? 'auto' : 380 }}>
          {s.voicemails.map((v) => <div key={v.id} style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: `1px solid ${LINE}`, paddingTop: 6 }}>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700 }}>{v.call.name} {v.returned && <span style={{ color: GREEN }}>✓</span>}</div>
              <div style={{ fontSize: 11.5, color: MUTED }}>{fmtPhone(v.call.phone)} · {v.overnight ? 'last night' : 'missed call'}</div>
              {v.listened && <div style={{ fontSize: 12, marginTop: 2 }}>“{v.call.voicemail}”</div>}</div>
            <button style={mini} onClick={() => { R.listenVoicemail(s, v.id); onListen(v); done(); }}>▶ Listen</button>
            <Btn small disabled={!!s.onCall || v.returned} onClick={() => { R.callBack(s, v.id); setVmOpen(false); done(); }}>Call back</Btn>
          </div>)}
        </div>}
      </div>}
    </div>
  );
}

export function CallCard({ s, narrow, talkEl, twoPlayer, done, beforeAct }: Props) {
  const oc = s.onCall; const [q, setQ] = useState(''); const [xfer, setXfer] = useState(false); const [err, setErr] = useState<string | null>(null);
  if (!oc) return null;
  const c = oc.call, k = c.kind, f = oc.form, cur = s.cur; const acts = R.actsFor(s); const found = R.bookingBy(s, oc.found); const id = R.clientByPhone(s, c.phone);
  const run = (fn: () => void) => { beforeAct?.(); setErr(null); fn(); done(); };
  const chip = (a: R.Act) => <button key={a.id} onClick={() => run(() => R.act(s, a.id))} style={{ ...mini, textAlign: 'left', borderRadius: 12, background: a.done ? '#eaf6ef' : '#fff', color: a.done ? GREEN : INK, borderColor: a.done ? '#cfe8da' : LINE }}>{a.done ? '✓ ' : ''}{a.label}</button>;
  const group = (g: R.Act['group']) => acts.filter((a) => a.group === g);
  const field = (key: string, label: string, ph = '') => <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: MUTED, fontWeight: 600 }}>{label}<input aria-label={label} value={f[key] || ''} placeholder={ph} onChange={(e) => { R.setField(s, key, e.target.value); done(); }} style={input} /></label>;
  const section = (title: string, body: ReactNode) => <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><div style={{ fontSize: 11, fontWeight: 800, color: MUTED, letterSpacing: '.06em' }}>{title}</div>{body}</div>;
  const row = (x: ReactNode) => <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{x}</div>;
  const svc = R.serviceBy(f.service);
  const booking = (k === 'book' || (k === 'price' && oc.did.offeredBook)) && oc.outcome?.kind !== 'booked';
  const outcomeText = oc.outcome ? ({ rescheduled: 'Moved. A confirmation text goes out.', cancelled: 'Cancelled.', message: 'Message saved.', booked: 'Booked. A confirmation text goes out.', answered: 'Answered.', giftcard: 'Gift card sent once paid.', transferred: 'Transferred.', declined: 'Declined politely.', redirected: 'Redirected.', repair: 'Free fix booked.' } as Record<string, string>)[oc.outcome.kind] : null;
  return (
    <div style={{ position: 'fixed', right: narrow ? 6 : 24, left: narrow ? 6 : 'auto', top: narrow ? 'auto' : 122, bottom: narrow ? 6 : 'auto', width: narrow ? 'auto' : 420, maxHeight: narrow ? '76vh' : 'calc(100vh - 140px)', overflow: 'auto', zIndex: 44, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 22, padding: 14, boxShadow: '0 30px 60px -30px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 32, height: 32, borderRadius: 16, background: INK, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{c.outbound ? '↗' : '🎧'}</span>
        <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 14.5 }}>{c.outbound ? 'Calling' : 'On a call'} · {c.name}</b>
          <div style={{ fontSize: 11.5, color: MUTED }}>Line {oc.line} · {fmtPhone(c.phone)} · {mmss(s.t - oc.started)}{oc.holds ? ` · held ${oc.holds}×` : ''}</div></div>
        <Chip tone="blue">{R.KIND_LABEL[k]}</Chip>
      </div>
      {!c.outbound && <div style={{ background: SOFT, borderRadius: 12, padding: '7px 10px', fontSize: 12 }}><b>Caller ID</b> · {id ? <>{id.name} <span style={{ color: MUTED }}>({id.note})</span></> : <span style={{ color: MUTED }}>Not in your clients. Ask their name.</span>}</div>}
      {cur && !oc.outcome && <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', background: '#fdf6ec', borderRadius: 12, padding: '6px 9px' }}>
        <span style={{ fontSize: 12, color: AMBER, fontWeight: 600, flex: 1, minWidth: 140 }}>{cur.c.name} is waiting at the desk.</span>
        <button style={mini} onClick={() => run(() => R.holdCall(s, true))}>“May I place you on a brief hold?”</button><button style={{ ...mini, color: MUTED }} onClick={() => run(() => R.holdCall(s, false))}>Hold</button></div>}
      {twoPlayer ? <div style={{ fontSize: 12.5, color: BLUE, fontWeight: 600 }}>Player 2 is the caller: their role card is on the client screen. Talk out loud.</div> : oc.said ? <Say tone="soft">{oc.said}</Say> : <div style={{ fontSize: 12.5, color: MUTED }}>{c.outbound ? 'It’s ringing… they pick up.' : 'You picked up. Say your greeting.'}</div>}
      {talkEl}
      {section('SAY', row(group('script').filter((a) => !['readBack', 'anythingElse', 'policy'].includes(a.id)).map(chip)))}
      {group('ask').length > 0 && section('ASK', row(group('ask').map(chip)))}
      {(k === 'reschedule' || k === 'cancel') && section('THEIR BOOKING', <>
        {!found ? <><input aria-label="Search bookings for the caller" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or phone" style={input} />
          {q && R.searchBookings(s, q).slice(0, 5).map((b) => <button key={b.id} onClick={() => run(() => R.callFind(s, b.id))} style={{ ...mini, borderRadius: 10, display: 'flex', gap: 8, textAlign: 'left' }}><b style={{ flex: 1 }}>{b.name}</b><span style={{ color: MUTED }}>{b.when} · {b.service}</span></button>)}</>
          : <div style={{ background: SOFT, borderRadius: 10, padding: '7px 10px', fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 6 }}><b style={{ flex: 1 }}>{found.name} · {found.when}</b><button style={mini} onClick={() => run(() => { oc.found = null; })}>Change</button></div>
            <div>{found.service} with {found.provider} · {found.courtesyLeft} courtesy left</div>
            {found.day === 'Sun' && <div style={{ color: AMBER }}>Tomorrow morning: inside 24 hours. Late-cancel fee ${R.CANCEL_FEE} unless a courtesy is used.</div>}</div>}
        {found && !oc.outcome && <>
          {row(<button style={mini} disabled={oc.offeredAnotherDay} onClick={() => run(() => R.offerAnotherDay(s))}>{oc.offeredAnotherDay ? 'Offered another day ✓' : '“Would another day work better?”'}</button>)}
          <div style={{ fontSize: 12, fontWeight: 700 }}>Move it to</div>{row(R.OPEN_SLOTS.map((sl) => <button key={sl} style={mini} onClick={() => run(() => R.callReschedule(s, sl))}>{sl}</button>))}
          <div style={{ fontSize: 12, fontWeight: 700 }}>Or cancel</div>{row(<><button style={mini} onClick={() => run(() => R.callCancel(s, false))}>Cancel{found.day === 'Sun' ? ', use a courtesy (no fee)' : ''}</button>{found.day === 'Sun' && <button style={mini} onClick={() => run(() => R.callCancel(s, true))}>Cancel, charge ${R.CANCEL_FEE}</button>}</>)}</>}
      </>)}
      {k === 'price' && !oc.did.offeredBook && section('QUOTE FROM THE MENU', row(group('quote').map(chip)))}
      {booking && section('NEW BOOKING', <>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: MUTED, fontWeight: 600 }}>Service
          <select aria-label="Service" value={f.service || ''} onChange={(e) => { R.setField(s, 'service', e.target.value); R.setField(s, 'slot', ''); done(); }} style={input}><option value="">Choose…</option>{R.MENU.filter((m) => m.slots.length).map((m) => <option key={m.key} value={m.key}>{m.name} · ${m.price} · {m.minutes} min · {m.provider}</option>)}</select></label>
        {svc && <>{row(svc.slots.map((sl) => <button key={sl} onClick={() => { R.setField(s, 'slot', sl); done(); }} style={{ ...mini, background: f.slot === sl ? INK : '#fff', color: f.slot === sl ? '#fff' : INK }}>{sl} · {svc.provider}</button>))}</>}
        <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr', gap: 6 }}>{field('name', 'Full name')}{field('phone', 'Mobile', '(919) 555-…')}</div>{field('email', 'Email', 'name@…')}
        {row(group('script').filter((a) => a.id === 'policy').map(chip))}{row(group('do').map(chip))}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Btn small onClick={() => run(() => { const r = R.bookNew(s); if (r && !r.ok) setErr(r.why); })}>Book it</Btn>{err && <span style={{ fontSize: 12, color: RED }}>{err}</span>}</div>
      </>)}
      {k === 'giftcard' && !oc.outcome && section('GIFT CARD', <>
        {row([25, 50, 75, 100, 150].map((n) => <button key={n} onClick={() => { R.setField(s, 'amount', String(n)); done(); }} style={{ ...mini, background: f.amount === String(n) ? INK : '#fff', color: f.amount === String(n) ? '#fff' : INK }}>${n}</button>))}
        <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr', gap: 6 }}>{field('recipient', 'Who it’s for')}{field('recipientEmail', 'Send it to (email)')}</div>
        {row(group('do').map(chip))}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Btn small onClick={() => run(() => { const r = R.sendGiftCard(s); if (r && !r.ok) setErr(r.why); })}>Send the gift card</Btn>{err && <span style={{ fontSize: 12, color: RED }}>{err}</span>}</div>
      </>)}
      {k === 'directions' && section('WHERE WE ARE', <><div style={{ background: SOFT, borderRadius: 10, padding: '7px 10px', fontSize: 12.5 }}>{R.SALON.address}<br /><span style={{ color: MUTED }}>{R.SALON.parking}</span></div>{row(group('do').map(chip))}</>)}
      {k === 'upset' && !oc.outcome && section('MAKE IT RIGHT', <><div style={{ fontSize: 12, color: MUTED }}>Gel that lifts within 7 days gets a free fix.</div>{row(R.REPAIR_SLOTS.map((sl) => <button key={sl} style={mini} onClick={() => run(() => R.offerRepair(s, sl))}>Offer a free fix · {sl}</button>))}</>)}
      {k === 'provider' && !oc.outcome && section('MESSAGE FOR ANA', <>
        <textarea aria-label="Message" value={f.message || ''} onChange={(e) => { R.setField(s, 'message', e.target.value); done(); }} placeholder="Who, their number, and what it’s about" rows={2} style={{ ...input, resize: 'vertical' }} />
        {row(<><Btn small onClick={() => run(() => R.takeMessage(s, f.message || '', 'Ana'))}>Save the message for Ana</Btn><button style={mini} onClick={() => run(() => R.transfer(s, 'Ana’s voicemail', true))}>Transfer to Ana’s voicemail</button></>)}</>)}
      {(k === 'reschedule' || k === 'cancel') && !oc.outcome && row(<button style={{ ...mini, color: MUTED }} onClick={() => run(() => R.takeMessage(s))}>Take a message</button>)}
      {!oc.outcome && <div>
        <button style={{ ...mini, color: MUTED }} onClick={() => setXfer((v) => !v)}>Transfer… {xfer ? '▴' : '▾'}</button>
        {xfer && <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
          <button style={{ ...mini, borderRadius: 10, textAlign: 'left' }} onClick={() => run(() => R.transfer(s, R.MANAGER, true))}>{R.MANAGER} (manager): tell her who’s calling and why, then connect</button>
          <button style={{ ...mini, borderRadius: 10, textAlign: 'left' }} onClick={() => run(() => R.transfer(s, R.MANAGER, false))}>{R.MANAGER} (manager): just transfer</button>
          {R.STAFF.map((p) => <button key={p} style={{ ...mini, borderRadius: 10, textAlign: 'left', color: MUTED }} onClick={() => run(() => R.transfer(s, p, false))}>{p} (with a client right now)</button>)}
        </div>}
      </div>}
      {group('risky').length > 0 && !oc.outcome && section('OTHER THINGS PEOPLE DO', row(group('risky').map((a) => <button key={a.id} onClick={() => run(() => R.act(s, a.id))} style={{ ...mini, color: MUTED, borderStyle: 'dashed' }}>{a.label}</button>)))}
      {oc.outcome && <div style={{ background: '#eaf6ef', color: GREEN, borderRadius: 12, padding: '8px 11px', fontSize: 12.5, fontWeight: 600 }}>{outcomeText} Now close the call.</div>}
      {section('CLOSE', row(acts.filter((a) => a.id === 'readBack' || a.id === 'anythingElse').map(chip)))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Btn small onClick={() => run(() => R.endCall(s))}>Hang up</Btn><span style={{ flex: 1 }} /><a href="/practice/register/scripts" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: MUTED }}>Phone scripts ↗</a></div>
    </div>
  );
}

/** After each call: what happened, the etiquette checklist, and what to do next time. */
export function CallReviewCard({ rv, narrow, onClose }: { rv: R.CallReview; narrow: boolean; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'fixed', left: narrow ? 8 : 24, right: narrow ? 8 : 'auto', bottom: narrow ? 8 : 24, zIndex: 45, width: narrow ? 'auto' : 380, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 20, padding: 14, boxShadow: '0 30px 60px -30px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '60vh', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ flex: 1 }}><div style={{ fontSize: 11, letterSpacing: '.08em', color: MUTED, fontWeight: 700 }}>CALL REVIEW · {R.KIND_LABEL[rv.kind].toUpperCase()}</div><b style={{ fontSize: 15 }}>{rv.who} · {rv.result}</b></div>
        <div style={{ fontSize: 20, fontWeight: 800, color: rv.score >= 80 ? GREEN : rv.score >= 50 ? AMBER : RED }}>{rv.score}%</div></div>
      {rv.checklist.map((i) => <div key={i.label} style={{ fontSize: 12.5, display: 'flex', gap: 7 }}><span style={{ color: i.ok ? GREEN : AMBER, fontWeight: 800 }}>{i.ok ? '✓' : '○'}</span><span style={{ color: i.ok ? INK : MUTED }}>{i.label}</span></div>)}
      {rv.mistakes.map((m, j) => <div key={j} style={{ fontSize: 12.5, borderTop: `1px solid ${LINE}`, paddingTop: 6 }}><b>{m.what}</b><div style={{ color: GREEN }}>✓ {m.right}</div></div>)}
      {rv.transcript.length > 0 && <button style={{ ...mini, alignSelf: 'flex-start' }} onClick={() => setOpen((v) => !v)}>{open ? 'Hide' : 'Show'} the conversation</button>}
      {open && rv.transcript.map((t, j) => <div key={j} style={{ fontSize: 12.5, alignSelf: t.who === 'you' ? 'flex-end' : 'flex-start', background: t.who === 'you' ? INK : SOFT, color: t.who === 'you' ? '#fff' : INK, borderRadius: 12, padding: '5px 9px', maxWidth: '88%' }}>{t.text}</div>)}
      <div style={{ display: 'flex' }}><span style={{ flex: 1 }} /><Btn small ghost onClick={onClose}>Got it</Btn></div>
    </div>
  );
}
