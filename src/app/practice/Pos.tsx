'use client';
// The game's front-desk checkout, modeled on ClarityFlow's POS: the client's profile, the ticket, the retail shelf
// (recommend, then scan), rebooking, the card reader (tap, insert or swipe; the client picks the tip), the cash drawer
// (count the change), and the receipt. Rules: lib/practice/sim (ticketFor, recommend, scan, askRebook, pay).
import { useEffect, useState, type ReactNode } from 'react';
import * as G from '@/lib/practice/sim';

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', GREEN = '#1f7a4d', AMBER = '#b45309', RED = '#b42318', BLUE = '#2563eb';
type Step = 'ticket' | 'tip' | 'card' | 'processing' | 'approved' | 'cash' | 'receipt' | 'printing' | 'done';

export default function Pos({ st, pid, narrow, onClose, onDone, sfx }: { st: G.State; pid: string; narrow: boolean; onClose: () => void; onDone: (msg: string) => void; sfx: (k: string) => void }) {
  const c = st.people[pid];
  const [step, setStep] = useState<Step>('ticket');
  const [reply, setReply] = useState<{ text: string; yes: boolean } | null>(null);
  const [pending, setPending] = useState<string[]>([]);    // products the client said yes to, waiting to be scanned
  const [scanning, setScanning] = useState<string | null>(null);
  const [rebook, setRebook] = useState<{ yes: boolean; when: string } | null>(null);
  const [given, setGiven] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [cardWay, setCardWay] = useState<string | null>(null);
  const [result, setResult] = useState<{ total: number; retail: number; exact: boolean } | null>(null);
  const [receiptKind, setReceiptKind] = useState<string | null>(null);
  const [, force] = useState(0);
  const tk = G.ticketFor(st, pid) || lastTicket;
  if (tk && G.ticketFor(st, pid)) lastTicket = tk;
  useEffect(() => { lastTicket = null; }, [pid]);
  if (!c || !tk) return null;
  const shelf = G.shelfFor(st, pid); const kind = st.flags[`kind:${pid}`];
  const hand = (c.hand || []).filter((k) => !(c.cart || []).includes(k));
  const doScan = (key: string) => { setScanning(key); sfx('tap'); window.setTimeout(() => { G.scan(st, pid, key); setScanning(null); setPending((p) => p.filter((x) => x !== key)); setErr(null); sfx('scan'); force((x) => x + 1); }, 650); };
  const recommend = (key: string) => { const r = G.recommend(st, pid, key); setReply({ text: r.reply, yes: r.yes }); if (r.yes) setPending((p) => [...p, key]); force((x) => x + 1); };
  const approve = (way: string) => { setCardWay(way); setStep('processing'); sfx('tap'); window.setTimeout(() => { const r = G.pay(st, pid); if (!r.ok) { setErr(r.error || ''); setStep('ticket'); return; } setResult({ total: r.total, retail: r.retail, exact: false }); setStep('approved'); sfx('coin'); window.setTimeout(() => setStep('receipt'), 900); }, 1100); };
  const handOver = (change: number) => { const r = G.pay(st, pid, { change }); if (!r.ok) { setTries((t) => t + 1); setErr(tries >= 1 ? r.error || '' : 'Not quite. Count it again.'); setGiven([]); return; } setResult({ total: r.total, retail: r.retail, exact: r.exact }); sfx('coin'); setStep('receipt'); };
  const finish = (kindR: string) => {
    setReceiptKind(kindR);
    if (kindR === 'print') { setStep('printing'); sfx('ping'); window.setTimeout(() => setStep('done'), 1600); } else setStep('done');
  };
  const close = () => onDone(`${c.name} paid $${result?.total ?? tk.total}.${result?.retail ? ` Products: $${result.retail}.` : ''}${rebook?.yes ? ' Rebooked!' : ''}`);
  const tipPct = c.price ? Math.round((tk.tip / c.price) * 100) : 0;
  const changeDue = tk.given - tk.total; const sum = given.reduce((a, b) => a + b, 0);
  const lockedTicket = step !== 'ticket';

  const Profile = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ width: 46, height: 46, borderRadius: 23, background: c.look.outfit, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 17, textShadow: '0 1px 2px rgba(0,0,0,.35)' }}>{c.name[0]}</span>
        <div><div style={{ fontSize: 17, fontWeight: 700 }}>{c.name}</div><div style={{ fontSize: 12, color: MUTED }}>{c.trait === 'first' ? 'First visit' : `${ordinal((c.visits || 0) + 1)} visit`}</div></div>
      </div>
      {c.trait && <div title={G.TRAITS[c.trait].tip} style={{ background: SOFT, borderRadius: 12, padding: '8px 10px' }}><Chip tone={c.trait === 'hurry' ? 'amber' : c.trait === 'regular' ? 'green' : c.trait === 'first' ? 'blue' : undefined}>{G.TRAITS[c.trait].label}</Chip><div style={{ fontSize: 12, color: MUTED, marginTop: 5, lineHeight: 1.4 }}>{G.TRAITS[c.trait].tip}</div></div>}
      <Field k="Today" v={`${c.service || 'Service'}${c.provider && st.people[c.provider] ? ` with ${st.people[c.provider].name}` : ''}`} />
      {c.notes && <Field k="Notes" v={c.notes} />}
      <Field k="Card on file" v={c.trait === 'first' ? 'None yet' : '•••• 4821'} />
      <div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: MUTED }}><span>Mood</span><span>{Math.round(c.patience * 100)}%</span></div><Bar pct={c.patience * 100} c={c.patience > 0.6 ? '#2f9e63' : c.patience > 0.3 ? '#e0911f' : '#d6453a'} /></div>
    </div>);

  const Ticket = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, fontWeight: 700 }}>Ticket</div>
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, overflow: 'hidden' }}>
        {tk.lines.map((l, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', borderTop: i ? `1px solid ${LINE}` : 'none', fontSize: 13.5 }}>
          <span>{l.kind === 'retail' ? '🛍 ' : ''}{l.label}</span><span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>${l.price}{l.kind === 'retail' && !lockedTicket && <button onClick={() => { G.unscan(st, pid, SHELF_KEY(l.label)); force((x) => x + 1); }} style={xBtn}>×</button>}</span></div>)}
        {step !== 'ticket' && tk.tip > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 12px', borderTop: `1px solid ${LINE}`, fontSize: 13.5, color: GREEN }}><span>Tip ({tipPct}%, {c.name}’s choice)</span><span>${tk.tip}</span></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderTop: `1px solid ${LINE}`, background: SOFT, fontWeight: 800, fontSize: 15 }}><span>{step === 'ticket' ? 'Subtotal' : 'Total'}</span><span>${step === 'ticket' ? tk.subtotal : tk.total}</span></div>
      </div>
      {hand.length > 0 && step === 'ticket' && hand.map((k) => { const it = G.SHELF.find((x) => x.key === k)!; return <div key={k} style={{ border: `1.5px dashed ${BLUE}`, borderRadius: 14, padding: '9px 11px', display: 'flex', alignItems: 'center', gap: 10, background: '#f4f7ff' }}>
        <Bottle color={it.color} /><div style={{ flex: 1, fontSize: 13 }}><b>{c.name} brought {it.name.toLowerCase()} to the desk.</b><div style={{ color: MUTED, fontSize: 12 }}>Scan it to add it to the ticket.</div></div>
        <ScanBtn busy={scanning === k} onClick={() => doScan(k)} /></div>; })}
      {reply && <div style={{ alignSelf: 'flex-start', background: reply.yes ? '#eaf6ef' : SOFT, color: reply.yes ? GREEN : INK, borderRadius: '14px 14px 14px 4px', padding: '8px 12px', fontSize: 13, fontWeight: 600 }}>{c.name}: “{reply.text}”</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', border: `1px solid ${LINE}`, borderRadius: 14, padding: '9px 11px' }}>
        <span style={{ fontSize: 18 }}>📅</span>
        <div style={{ flex: 1, fontSize: 13 }}>{rebook ? (rebook.yes ? <b style={{ color: GREEN }}>Booked: {rebook.when}</b> : <span style={{ color: MUTED }}>“I’ll book online later, thanks.”</span>) : <><b>Book {G.their(c)} next visit</b><div style={{ fontSize: 12, color: MUTED }}>Ask before {G.they(c)} leaves.</div></>}</div>
        {!rebook && <Btn small onClick={() => { const r = G.askRebook(st, pid); setRebook(r); if (r.yes) sfx('chime'); }}>Ask</Btn>}
      </div>
      {err && <div style={{ color: RED, fontSize: 12.5, fontWeight: 600 }}>{err}</div>}
    </div>);

  const Shelf = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED, fontWeight: 700 }}>Retail · recommend, then scan</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {shelf.slice(0, narrow ? 4 : 6).map((it) => { const fits = it.for.includes(kind); const inCart = (c.cart || []).includes(it.key); const asked = c.asked?.[it.key]; const isPending = pending.includes(it.key);
          return <div key={it.key} style={{ border: `1.5px solid ${isPending ? GREEN : LINE}`, borderRadius: 14, padding: 9, display: 'flex', flexDirection: 'column', gap: 6, background: inCart ? '#f2f8f4' : '#fff', opacity: asked && !inCart && !isPending ? 0.55 : 1 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Bottle color={it.color} /><div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.2 }}>{it.name}</div><div style={{ fontSize: 12, color: MUTED }}>${it.price}</div></div></div>
            {fits && !inCart && <Chip tone="green">Fits {G.their(c)} service</Chip>}
            {inCart ? <span style={{ fontSize: 12, color: GREEN, fontWeight: 700 }}>✓ On the ticket</span>
              : isPending ? <ScanBtn busy={scanning === it.key} onClick={() => doScan(it.key)} />
              : !asked && !lockedTicket ? <Btn small ghost onClick={() => recommend(it.key)}>Recommend</Btn> : <span style={{ fontSize: 12, color: MUTED }}>Asked</span>}
          </div>; })}
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.4 }}>Tip: one or two that fit {G.their(c)} service. Pushing a third costs goodwill.</div>
    </div>);

  const Pay = (() => {
    if (step === 'ticket') return <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, color: MUTED, flex: 1 }}>{c.name} is paying by <b style={{ color: INK }}>{tk.method}</b>.</span>
      <Btn onClick={() => { const unscanned = pending.filter((k) => !(c.cart || []).includes(k)); if (unscanned.length) { setErr(`${c.name} said yes to the ${G.SHELF.find((x) => x.key === unscanned[0])!.name.toLowerCase()}. Scan it before you take payment.`); return; } setErr(null); if (tk.method === 'card') { setStep('tip'); window.setTimeout(() => setStep('card'), 1400); } else setStep('cash'); }}>Take payment · ${tk.subtotal}</Btn></div>;
    if (step === 'tip' || step === 'card' || step === 'processing' || step === 'approved') return <Reader step={step} total={tk.total} subtotal={tk.subtotal} tipPct={tipPct} way={cardWay} onWay={approve} name={c.name} />;
    if (step === 'cash') return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 13 }}>{c.name} hands you <b>${tk.given}</b> for <b>${tk.total}</b> (with a ${tk.tip} tip). Count the change from the drawer.</div>
      <div style={{ display: 'flex', gap: 6 }}>{G.DENOMS.map((d) => <button key={d} onClick={() => { setGiven((g) => [...g, d]); setErr(null); sfx('tap'); }} style={{ flex: 1, padding: '14px 0', borderRadius: 10, border: `1px solid ${LINE}`, background: d >= 5 ? '#e4efe2' : '#f3ecdc', fontFamily: 'inherit', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>${d}</button>)}</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minHeight: 24 }}>{given.map((g, i) => <span key={i} style={{ background: g >= 5 ? '#e4efe2' : '#f3ecdc', borderRadius: 5, padding: '2px 7px', fontSize: 12, fontWeight: 800 }}>${g}</span>)}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ fontSize: 14, flex: 1 }}>Change: <b>${sum}</b></span><Btn small ghost onClick={() => setGiven([])}>Clear</Btn><Btn onClick={() => handOver(sum)}>Hand it over</Btn></div>
      <button onClick={() => handOver(changeDue)} style={{ ...linkBtn }}>Count it for me (no bonus)</button>
    </div>;
    if (step === 'receipt') return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: GREEN }}>Paid ✓ ${result?.total}{result?.exact ? ' · exact change, nice!' : ''}</div>
      <div style={{ fontSize: 13 }}>Would {c.name} like a receipt?</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{[['print', 'Print'], ['text', 'Text it'], ['email', 'Email it'], ['none', 'No receipt']].map(([k, l]) => <Btn key={k} small ghost={k !== 'print'} onClick={() => finish(k)}>{l}</Btn>)}</div>
    </div>;
    if (step === 'printing' || step === 'done') return <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {receiptKind === 'print' && <Receipt tk={tk} name={c.name} printing={step === 'printing'} clock={G.clock(st)} />}
      <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: GREEN }}>{receiptKind === 'print' ? (step === 'printing' ? 'Printing…' : 'Receipt printed ✓') : receiptKind === 'none' ? 'All done ✓' : `Receipt ${receiptKind === 'text' ? 'texted' : 'emailed'} ✓`}</div>
        <div style={{ fontSize: 13, color: MUTED }}>{rebook?.yes ? `See you in 3 weeks, ${c.name}!` : `Thank you, ${c.name}!`}</div>
        {step === 'done' && <Btn onClick={close}>Done</Btn>}
      </div></div>;
    return null;
  })();

  const body = narrow
    ? <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{Profile}{Ticket}{step === 'ticket' && Shelf}<Hr />{Pay}</div>
    : <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr 300px', gap: 18, alignItems: 'start' }}>{Profile}<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{Ticket}<Hr />{Pay}</div>{step === 'ticket' ? Shelf : <div style={{ fontSize: 12.5, color: MUTED, background: SOFT, borderRadius: 14, padding: 12 }}>Products are locked once payment starts.</div>}</div>;
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(22,23,26,.28)', zIndex: 11, display: 'flex', alignItems: narrow ? 'flex-end' : 'center', justifyContent: 'center', padding: narrow ? 0 : 16 }}>
      <div style={{ width: narrow ? '100%' : 960, maxHeight: narrow ? '92vh' : '90vh', overflow: 'auto', background: '#fff', borderRadius: narrow ? '20px 20px 0 0' : 22, padding: narrow ? '16px 14px 20px' : '18px 22px 22px', boxShadow: '0 30px 80px -30px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 15, background: INK, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>$</span>
          <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700 }}>Front desk · Checkout</div><div style={{ fontSize: 12, color: MUTED }}>Time is paused while you check {G.they(c) === 'he' ? 'him' : 'her'} out</div></div>
          {(step === 'ticket' || step === 'cash') && <Btn small ghost onClick={onClose}>Not now</Btn>}
        </div>
        {body}
      </div>
    </div>);
}
let lastTicket: G.Ticket | null = null;
const SHELF_KEY = (label: string) => G.SHELF.find((x) => x.name === label)?.key || '';

function Reader({ step, total, subtotal, tipPct, way, onWay, name }: { step: Step; total: number; subtotal: number; tipPct: number; way: string | null; onWay: (w: string) => void; name: string }) {
  return <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
    <div style={{ width: 170, height: 210, borderRadius: 22, background: '#1f2024', padding: 10, boxShadow: 'inset 0 0 0 2px #2c2d33', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
      <div style={{ flex: 1, borderRadius: 12, background: step === 'approved' ? '#1f7a4d' : '#fafafa', color: step === 'approved' ? '#fff' : INK, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8, textAlign: 'center', transition: 'background .3s' }}>
        {step === 'tip' && <><div style={{ fontSize: 11, color: MUTED }}>Add a tip?</div><div style={{ display: 'flex', gap: 4 }}>{[15, 20, 25].map((p) => <span key={p} style={{ fontSize: 11, fontWeight: 800, padding: '4px 6px', borderRadius: 6, background: Math.abs(p - tipPct) <= 3 ? INK : SOFT, color: Math.abs(p - tipPct) <= 3 ? '#fff' : INK }}>{p}%</span>)}</div><div style={{ fontSize: 10.5, color: MUTED }}>{name} is choosing…</div></>}
        {step === 'card' && <><div style={{ fontSize: 22, fontWeight: 800 }}>${total}</div><div style={{ fontSize: 11 }}>Tap, insert or swipe</div><div style={{ fontSize: 24 }}>💳</div></>}
        {step === 'processing' && <><div style={{ fontSize: 22, fontWeight: 800 }}>${total}</div><div style={{ fontSize: 11 }}>{way === 'tap' ? 'Reading card…' : way === 'insert' ? 'Don’t remove card…' : 'Reading stripe…'}</div><Spinner /></>}
        {step === 'approved' && <><div style={{ fontSize: 30 }}>✓</div><div style={{ fontSize: 14, fontWeight: 800 }}>Approved</div><div style={{ fontSize: 11 }}>${total}</div></>}
      </div>
      <div style={{ height: 8, borderRadius: 4, background: '#2c2d33', margin: '0 18px' }} />
    </div>
    <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {step === 'tip' && <div style={{ fontSize: 13 }}>{name} is choosing a tip on the reader. Subtotal ${subtotal}.</div>}
      {step === 'card' && <><div style={{ fontSize: 13 }}>How is {name} paying?</div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{[['tap', 'Tap'], ['insert', 'Insert chip'], ['swipe', 'Swipe']].map(([k, l]) => <Btn key={k} onClick={() => onWay(k)}>{l}</Btn>)}</div><div style={{ fontSize: 12, color: MUTED }}>Total ${total}, tip included.</div></>}
      {step === 'processing' && <div style={{ fontSize: 13, color: MUTED }}>Processing…</div>}
      {step === 'approved' && <div style={{ fontSize: 14, fontWeight: 700, color: GREEN }}>Approved ✓</div>}
    </div>
  </div>;
}
function Receipt({ tk, name, printing, clock }: { tk: G.Ticket; name: string; printing: boolean; clock: string }) {
  return <div style={{ width: 200, overflow: 'hidden', height: printing ? 60 : 'auto', transition: 'height 1.4s ease-out', background: '#fffdf8', border: `1px solid ${LINE}`, borderRadius: 6, padding: '10px 12px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, lineHeight: 1.5, boxShadow: '0 10px 20px -14px rgba(0,0,0,.4)' }}>
    <div style={{ textAlign: 'center', fontWeight: 800 }}>OPAL SALON</div><div style={{ textAlign: 'center', color: MUTED }}>Sat · {clock}</div>
    <div style={{ borderTop: '1px dashed #ccc', margin: '6px 0' }} />
    {tk.lines.map((l, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{l.label}</span><span>{l.price.toFixed(2)}</span></div>)}
    {tk.tip > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tip</span><span>{tk.tip.toFixed(2)}</span></div>}
    <div style={{ borderTop: '1px dashed #ccc', margin: '6px 0' }} />
    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}><span>TOTAL</span><span>{tk.total.toFixed(2)}</span></div>
    <div style={{ textAlign: 'center', marginTop: 6 }}>Thank you, {name}!</div>
  </div>;
}
function Bottle({ color }: { color: string }) { return <span style={{ width: 22, height: 34, borderRadius: '6px 6px 5px 5px', background: color, border: '1px solid rgba(0,0,0,.08)', position: 'relative', flexShrink: 0 }}><span style={{ position: 'absolute', left: 6, top: -6, width: 10, height: 7, borderRadius: 2, background: '#2b2b2b' }} /></span>; }
function ScanBtn({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return <button onClick={onClick} disabled={busy} style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 10, border: `1px solid ${INK}`, background: '#fff', fontFamily: 'inherit', cursor: 'pointer', minWidth: 120 }}>
    <svg width="54" height="20" viewBox="0 0 54 20">{Array.from({ length: 18 }).map((_, i) => <rect key={i} x={i * 3} y={0} width={i % 3 === 0 ? 2 : 1} height={20} fill={INK} />)}</svg>
    <span style={{ fontSize: 12, fontWeight: 700 }}>{busy ? 'Scanning…' : 'Scan'}</span>
    {busy && <span style={{ position: 'absolute', left: 0, right: 0, height: 2, background: '#e11d48', boxShadow: '0 0 8px #e11d48', animation: 'scanbeam .6s ease-in-out infinite alternate' }} />}
    <style>{'@keyframes scanbeam{from{top:4px}to{top:calc(100% - 6px)}}'}</style>
  </button>;
}
function Spinner() { return <span style={{ width: 20, height: 20, borderRadius: 10, border: `2.5px solid ${LINE}`, borderTopColor: INK, animation: 'spin .8s linear infinite', display: 'inline-block' }}><style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style></span>; }
function Field({ k, v }: { k: string; v: string }) { return <div><div style={{ fontSize: 11, color: MUTED, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>{k}</div><div style={{ fontSize: 13, lineHeight: 1.4, marginTop: 2 }}>{v}</div></div>; }
function Hr() { return <div style={{ borderTop: `1px solid ${LINE}` }} />; }
function Bar({ pct, c }: { pct: number; c: string }) { return <div style={{ height: 6, borderRadius: 3, background: SOFT, marginTop: 3 }}><div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: 6, borderRadius: 3, background: c }} /></div>; }
function Chip({ children, tone }: { children: ReactNode; tone?: 'green' | 'amber' | 'blue' }) {
  const [bg, fg] = tone === 'green' ? ['#e8f3ec', GREEN] : tone === 'amber' ? ['#fdf1e3', AMBER] : tone === 'blue' ? ['#e8efff', BLUE] : [SOFT, INK];
  return <span style={{ background: bg, color: fg, borderRadius: 999, padding: '3px 9px', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', alignSelf: 'flex-start' }}>{children}</span>;
}
function Btn({ children, onClick, ghost, small }: { children: ReactNode; onClick?: () => void; ghost?: boolean; small?: boolean }) {
  return <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: small ? '6px 12px' : '10px 18px', borderRadius: 999, fontSize: small ? 12.5 : 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.2, background: ghost ? '#fff' : INK, color: ghost ? INK : '#fff', border: `1px solid ${ghost ? LINE : INK}` }}>{children}</button>;
}
const xBtn = { width: 20, height: 20, borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: '16px', padding: 0 } as const;
const linkBtn = { background: 'none', border: 'none', color: MUTED, fontSize: 12.5, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start', padding: 0 } as const;
