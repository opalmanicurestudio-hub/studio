'use client';
import { Icon } from '@/components/pos/desk/kit';
// src/components/pos/SplitBill.tsx — SPLIT THE BILL at the desk. Evenly, by person (each guest pays for their own visit),
// by item, or custom amounts. Each share is paid its own way — cash (with change), a saved card (anyone in the party),
// on the client screen (that person sees "Your share", adds their own tip, pays by card or on their phone), or other.
// Every share is recorded on the started ticket AS IT'S PAID (the server checks card payments with Stripe), so if it
// stops halfway nothing is lost. When nothing is left, Finish sale → one sale, one receipt, one void.
import * as React from 'react';
import { getAuth } from 'firebase/auth';

async function post(url: string, body: any) {
  const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the server.' }));
}
const money = (n: any) => `$${(Number(n) || 0).toFixed(2)}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
export interface SplitLine { key: string; label: string; amount: number; personId: string | null; personName: string | null }
export interface SplitPerson { id: string; name: string; card: string | null }
type Share = { key: string; label: string; amount: number; personId: string | null };

export function SplitBill({ tenantId, owed, lines, people, payerId, prepare, takenShares, onFinish, onCancel, screen, askTip, tipBaseFor }: {
  tenantId: string; owed: number; lines: SplitLine[]; people: SplitPerson[]; payerId: string | null;
  prepare: () => Promise<string | null>; onFinish: (paid: number) => void; onCancel: () => void;
  /** The shares already taken on the ticket (checkout was closed and opened again): shown as paid, never taken twice. */
  takenShares?: () => any[];
  screen?: { connected: boolean; name: string | null; ask: (kind: string, extra?: any) => Promise<string | null>; askFull?: (kind: string, extra?: any) => Promise<any>; response: any } | null;
  askTip?: boolean; tipBaseFor?: (shareAmount: number) => number;
}) {
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<'even' | 'person' | 'item' | 'custom'>(people.length > 1 ? 'person' : 'even');
  const [ways, setWays] = React.useState(2);
  const [picked, setPicked] = React.useState<Record<string, string[]>>({});   // by item: share key → line keys
  const [customs, setCustoms] = React.useState<string[]>(['', '']);
  const [tenders, setTenders] = React.useState<any[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null); const [msg, setMsg] = React.useState<string | null>(null);
  const [payFor, setPayFor] = React.useState<string | null>(null); const [cashGiven, setCashGiven] = React.useState('');
  const [waiting, setWaiting] = React.useState<{ key: string; id: string } | null>(null);
  // A card share that was charged but whose record here didn't arrive: recorded again with the same payment (the card is
  // never charged again for it).
  const [unrecorded, setUnrecorded] = React.useState<{ share: Share; body: any } | null>(null);
  React.useEffect(() => { prepare().then((id) => { setPendingId(id);
    const taken = (takenShares?.() || []).filter((x: any) => x && x.id);
    if (!taken.length) return;
    // The way it was split, from the shares' names ("Share 1 of 3"), so each paid share shows against its own row.
    const even = taken.map((x: any) => /^Share \d+ of (\d+)$/.exec(String(x.label || ''))).find(Boolean);
    if (even) { setMode('even'); setWays(Math.max(2, Math.min(12, Number(even[1]) || 2))); }
    setTenders(taken.map((x: any) => ({ ...x, shareKey: null }))); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const paid = r2(tenders.reduce((s, t) => s + Number(t.amount || 0), 0)); const tipsOnShares = r2(tenders.reduce((s, t) => s + Number(t.tip || 0), 0));
  const left = Math.max(0, r2(owed - paid));
  // The shares for the chosen way of splitting (each worked out on what's owed, so tax and discounts are shared fairly).
  const sub = lines.reduce((s, l) => s + l.amount, 0) || 1;
  const shares: Share[] = React.useMemo(() => {
    if (mode === 'even') { const each = r2(owed / ways); return Array.from({ length: ways }, (_, i) => ({ key: `e${i}`, label: `Share ${i + 1} of ${ways}`, amount: i === ways - 1 ? r2(owed - each * (ways - 1)) : each, personId: null })); }
    if (mode === 'person') {
      const by = new Map<string, { name: string; amt: number }>();
      for (const l of lines) { const k = l.personId || payerId || 'payer'; const cur = by.get(k) || { name: l.personName || people.find((p) => p.id === k)?.name || 'Guest', amt: 0 }; cur.amt += l.amount; by.set(k, cur); }
      const arr = [...by.entries()].map(([id, v]) => ({ key: `p${id}`, label: String(v.name).split(' ')[0] || 'Guest', amount: r2(owed * (v.amt / sub)), personId: id === 'payer' ? payerId : id }));
      if (arr.length) arr[arr.length - 1].amount = r2(owed - arr.slice(0, -1).reduce((s, x) => s + x.amount, 0)); return arr;
    }
    if (mode === 'item') {
      const keys = Object.keys(picked).length ? Object.keys(picked) : ['i0', 'i1'];
      return keys.map((k, i) => { const amt = (picked[k] || []).reduce((s, lk) => s + (lines.find((l) => l.key === lk)?.amount || 0), 0); return { key: k, label: `Person ${i + 1}`, amount: r2(owed * (amt / sub)), personId: null }; });
    }
    return customs.map((c, i) => ({ key: `c${i}`, label: `Payment ${i + 1}`, amount: r2(Number(c) || 0), personId: null }));
  }, [mode, ways, owed, lines, people, payerId, picked, customs, sub]);
  // A share taken earlier (before checkout was opened again) matches its row by name.
  const shareTaken = (k: string) => tenders.find((t) => t.shareKey === k) || tenders.find((t) => !t.shareKey && t.label && t.label === shares.find((x) => x.key === k)?.label);
  const unmatched = tenders.filter((t) => !t.shareKey && !shares.some((x) => x.label === t.label));
  const record = async (share: Share, body: any): Promise<boolean> => {
    if (!pendingId) { setMsg('Still getting the ticket ready — try again in a moment.'); return false; }
    setBusy(share.key); setMsg(null);
    const r: any = await post('/api/checkout/complete', { tenantId, action: 'tender', pendingId, label: share.label, payerName: share.label, payerClientId: share.personId, ...body });
    setBusy(null);
    if (!r?.ok) {
      // A card share already charged: kept to record again (the server keeps it apart if the sale was paid or finished meanwhile).
      if (body.stripePaymentIntentId && !['ticket_paid', 'sale_done'].includes(String(r?.code || ''))) { setUnrecorded({ share, body }); setMsg(`${r?.error ? `${r.error} ` : ''}The card was charged, but this share didn’t record yet. Record it again; the card won’t be charged again.`); }
      else setMsg(r?.error || 'That didn’t record.');
      return false;
    }
    if (unrecorded && unrecorded.body?.stripePaymentIntentId === body.stripePaymentIntentId) setUnrecorded(null);
    const newId = r.tender?.id || (r.tenders || []).find((x: any) => body.stripePaymentIntentId && x.stripePaymentIntentId === body.stripePaymentIntentId)?.id;   // already recorded by the server (a share paid on the iPad)
    setTenders((r.tenders || []).map((t: any) => ({ ...t, shareKey: t.id === newId ? share.key : tenders.find((x) => x.id === t.id)?.shareKey || t.shareKey || null })));
    setPayFor(null); setCashGiven('');
    return true;
  };
  const remove = async (t: any) => {
    setBusy(t.id); const r: any = await post('/api/checkout/complete', { tenantId, action: 'tender_remove', pendingId, tenderId: t.id }); setBusy(null);
    if (!r?.ok) { setMsg(r?.error || 'Couldn’t remove it.'); return; }
    setTenders((r.tenders || []).map((x: any) => ({ ...x, shareKey: tenders.find((y) => y.id === x.id)?.shareKey || null }))); setMsg(r.refunded ? 'Removed — the card was refunded.' : 'Removed.');
  };
  const chargeSaved = async (share: Share, personId: string) => {
    if (!pendingId) { setMsg('Still getting the ticket ready — try again in a moment.'); return; }
    setBusy(share.key); setMsg(null);
    // The share names its ticket, so it's only ever taken (and refunded) for this sale, never for one already paid.
    const c: any = await post('/api/stripe/charge-card', { tenantId, clientId: personId, amountCents: Math.round(share.amount * 100), description: `Share of a split bill — ${share.label}`, category: 'Service Revenue', noLedger: true, pendingId, share: true, shareLabel: share.label });
    setBusy(null); if (!c?.ok) { setMsg(c?.code === 'reload' ? 'This screen needs reloading before it can take card payments. Reload the page; nothing was charged.' : c?.reason || c?.error || 'The card was declined.'); return; }
    // The sale was paid in full or finished on another screen meanwhile: this charge is extra, kept apart for a manager.
    if (c.sale === 'kept_apart') { setMsg(`This sale was already paid or finished, so that ${money(share.amount)} card payment is kept apart for a manager to refund in Needs attention. Don’t charge again.`); return; }
    await record(share, { method: 'card', amount: share.amount, stripePaymentIntentId: c.paymentIntentId, via: 'saved_card' });
  };
  const onScreen = async (share: Share) => {
    if (!screen?.connected || !pendingId) return;
    const ask = { amount: share.amount, clientId: share.personId || payerId, splitPendingId: pendingId, shareLabel: share.label, askTip: !!askTip, tipBase: tipBaseFor ? tipBaseFor(share.amount) : share.amount };
    const r: any = screen.askFull ? await screen.askFull('pay', ask) : await screen.ask('pay', ask);
    const id = typeof r === 'string' ? r : r?.ok ? r.requestId : null;
    if (id) setWaiting({ key: share.key, id }); else setMsg(r?.error || 'The client screen didn’t respond.');
  };
  // The client screen confirms the share (and the server has already recorded it) → pick it up here.
  React.useEffect(() => { const r = screen?.response; if (!r || !waiting || r.requestId !== waiting.id || r.kind !== 'pay') return;
    const share = shares.find((s) => s.key === waiting.key); setWaiting(null);
    if (r.paid && share && r.paymentIntentId) record(share, { method: 'card', amount: r2(Number(r.amount) - Number(r.tip || 0)), tip: Number(r.tip || 0), stripePaymentIntentId: r.paymentIntentId, via: 'client_screen' });
    else if (r.paid) setMsg('The payment on the client screen finished. Close and open Split the bill to see it before taking another payment.');
    else if (r.abandoned) setMsg(`${share?.label || 'They'} didn’t finish paying — nothing was charged.`); }, [screen?.response?.requestId]); // eslint-disable-line react-hooks/exhaustive-deps
  const box = { background: 'var(--card)', border: '1px solid var(--line)' } as React.CSSProperties; const soft = { background: 'var(--soft)' } as React.CSSProperties;
  const chip = (on: boolean) => (on ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : soft) as React.CSSProperties;
  const cardOwners = people.filter((p) => p.card);
  const sharesTotal = r2(shares.reduce((s, x) => s + x.amount, 0));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-[16px] font-semibold">Split the bill · {money(owed)}</p><button type="button" onClick={onCancel} disabled={tenders.length > 0} className="text-[13px] underline underline-offset-4 disabled:opacity-40" title={tenders.length ? 'Remove the payments taken first' : ''}>Don’t split</button></div>
      {!tenders.length && <div className="flex flex-wrap gap-1.5">{([['even', 'Evenly'], ['person', 'By person'], ['item', 'By item'], ['custom', 'Custom amounts']] as const).filter(([k]) => k !== 'person' || people.length > 1).map(([k, l]) =>
        <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} className="h-9 rounded-full px-3.5 text-[13px] font-semibold" style={chip(mode === k)}>{l}</button>)}</div>}
      {!tenders.length && mode === 'even' && <div className="flex items-center gap-2 text-[14px]">Between <button type="button" onClick={() => setWays((n) => Math.max(2, n - 1))} className="h-9 w-9 rounded-full" style={soft} aria-label="Fewer people">−</button><b className="w-6 text-center">{ways}</b><button type="button" onClick={() => setWays((n) => Math.min(12, n + 1))} className="h-9 w-9 rounded-full" style={soft} aria-label="More people">+</button> people</div>}
      {!tenders.length && mode === 'item' && <div className="space-y-2">{Object.keys(picked).length === 0 && <button type="button" onClick={() => setPicked({ i0: [], i1: [] })} className="h-9 rounded-full px-3.5 text-[13px] font-semibold" style={soft}>Start choosing items</button>}
        {Object.keys(picked).map((k, i) => <div key={k} className="rounded-2xl p-3" style={box}><p className="mb-1 text-[13px] font-semibold">Person {i + 1}</p><div className="flex flex-wrap gap-1.5">{lines.map((l) => { const mine = (picked[k] || []).includes(l.key); const taken = Object.entries(picked).some(([o, v]) => o !== k && v.includes(l.key));
          return <button key={l.key} type="button" disabled={taken} onClick={() => setPicked((p) => ({ ...p, [k]: mine ? p[k].filter((x) => x !== l.key) : [...(p[k] || []), l.key] }))} className="rounded-full px-3 py-1.5 text-[12px] disabled:opacity-30" style={chip(mine)}>{l.label} · {money(l.amount)}</button>; })}</div></div>)}
        {Object.keys(picked).length > 0 && <button type="button" onClick={() => setPicked((p) => ({ ...p, [`i${Object.keys(p).length}`]: [] }))} className="text-[13px] underline underline-offset-4">+ Another person</button>}</div>}
      {!tenders.length && mode === 'custom' && <div className="space-y-1.5">{customs.map((c, i) => <input key={i} value={c} onChange={(e) => setCustoms((cs) => cs.map((x, j) => (j === i ? e.target.value.replace(/[^\d.]/g, '') : x)))} inputMode="decimal" placeholder={`Payment ${i + 1} ($)`} aria-label={`Payment ${i + 1}`} className="h-11 w-full rounded-xl px-3 text-[16px]" style={box} />)}
        <button type="button" onClick={() => setCustoms((cs) => [...cs, ''])} className="text-[13px] underline underline-offset-4">+ Another payment</button></div>}
      {Math.abs(sharesTotal - owed) > 0.009 && !tenders.length && mode !== 'even' && mode !== 'person' && <p className="text-[13px]" style={{ color: 'var(--warn)' }}>These shares add up to {money(sharesTotal)} — the bill is {money(owed)}.</p>}
      {!!unmatched.length && <div className="space-y-1.5 rounded-2xl p-3" style={box}>
        <p className="text-[13px] font-semibold">Paid before</p>
        {unmatched.map((t) => <div key={t.id} className="flex items-center justify-between gap-2 text-[13px]"><span>{t.label || 'Payment'} · {money(Number(t.amount) + Number(t.tip || 0))} · {t.method === 'cash' ? 'cash' : t.method === 'card' ? 'card' : 'other'}</span>
          <button type="button" disabled={!!busy} onClick={() => remove(t)} className="underline underline-offset-4" style={{ color: 'var(--muted)' }}>{busy === t.id ? '…' : 'Remove'}</button></div>)}
      </div>}
      <div className="space-y-2">{shares.filter((s) => s.amount > 0).map((s) => { const t = shareTaken(s.key);
        return <div key={s.key} className="space-y-2 rounded-2xl p-3" style={box}>
          <div className="flex items-center justify-between gap-2"><p className="text-[15px] font-semibold">{s.label}</p><p className="text-[15px] tabular-nums">{money(s.amount)}</p></div>
          {t ? <div className="flex items-center justify-between text-[13px]"><span className="inline-flex items-center gap-1" style={{ color: 'var(--ok)' }}><Icon name="check" size={14} />Paid</span><span> · {t.method === 'cash' ? `cash${t.cashGiven > t.amount ? ` (change ${money(t.cashGiven - t.amount)})` : ''}` : t.method === 'card' ? (t.via === 'client_screen' ? `on ${screen?.name || 'the client screen'}` : 'card') : 'other'}{Number(t.tip) > 0 ? ` · +${money(t.tip)} tip` : ''}</span>
            <button type="button" disabled={!!busy} onClick={() => remove(t)} className="underline underline-offset-4" style={{ color: 'var(--muted)' }}>{busy === t.id ? '…' : 'Remove'}</button></div>
          : waiting?.key === s.key ? <div className="flex items-center justify-between text-[13px]"><span>Paying on {screen?.name}…</span><button type="button" onClick={() => { setWaiting(null); screen?.ask('idle'); }} className="underline underline-offset-4">Cancel</button></div>
          : payFor === s.key ? <div className="space-y-2">
              <div className="flex gap-2"><input value={cashGiven} onChange={(e) => setCashGiven(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="Cash given ($)" aria-label="Cash given" className="h-11 min-w-0 flex-1 rounded-xl px-3 text-[16px]" style={soft} />
                <button type="button" disabled={!!busy || !(Number(cashGiven) >= s.amount - 0.005)} onClick={() => record(s, { method: 'cash', amount: s.amount, cashGiven: Number(cashGiven) })} className="h-11 rounded-full px-4 text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Take cash</button></div>
              {Number(cashGiven) > s.amount && <p className="text-[14px] font-semibold">Change: {money(Number(cashGiven) - s.amount)}</p>}
              <button type="button" onClick={() => setPayFor(null)} className="text-[13px] underline underline-offset-4">Back</button></div>
          : <div className="flex flex-wrap gap-1.5">
              <button type="button" disabled={!!busy} onClick={() => setPayFor(s.key)} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={soft}>Cash</button>
              {screen?.connected && <button type="button" disabled={!!busy || !pendingId} onClick={() => onScreen(s)} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={soft}>On {screen.name}</button>}
              {cardOwners.map((p) => <button key={p.id} type="button" disabled={!!busy} onClick={() => chargeSaved(s, p.id)} className="h-9 rounded-full px-3 text-[13px] font-semibold" style={soft}>{busy === s.key ? 'Charging…' : `${String(p.name).split(' ')[0]}’s ${p.card}`}</button>)}
              <button type="button" disabled={!!busy} onClick={() => record(s, { method: 'other', amount: s.amount, note: 'Other' })} className="h-9 rounded-full px-3 text-[13px]" style={soft}>Other</button>
            </div>}
        </div>; })}</div>
      <div className="flex items-center justify-between rounded-2xl p-3 text-[15px]" style={soft}><span>{left > 0 ? 'Left to pay' : 'All paid'}{tipsOnShares > 0 ? ` · tips ${money(tipsOnShares)}` : ''}</span><b className="tabular-nums">{money(left)}</b></div>
      {msg && <p className="text-[13px] font-semibold" role="status">{msg}</p>}
      {unrecorded && <button type="button" disabled={!!busy} onClick={() => void record(unrecorded.share, unrecorded.body)} className="h-11 w-full rounded-full text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--soft)' }}>{busy === unrecorded.share.key ? 'Recording…' : `Record ${unrecorded.share.label} again`}</button>}
      <button type="button" disabled={left > 0.009 || !!busy || !tenders.length} onClick={() => onFinish(r2(paid + tipsOnShares))} className="h-12 w-full rounded-full text-[15px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>Finish sale</button>
    </div>
  );
}
