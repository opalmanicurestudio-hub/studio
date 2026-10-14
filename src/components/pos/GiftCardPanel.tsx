'use client';
// src/components/pos/GiftCardPanel.tsx — GIFT CARDS AT CHECKOUT (lib/gift-cards, /api/gift-cards).
//   Pay with one: the client's own cards are offered (one tap), or a code is typed or scanned; the amount is set aside on
//   the card (a 30-minute hold) so another till can't spend it, and comes off when the sale finishes.
//   Sell one: amount, who it's for, a note, and how it gets to them (text, email, printed or the code by hand), now or on a
//   chosen day. The card is made when the sale is saved.
import * as React from 'react';
import { payPost } from '@/components/pay/pay-client';
import { GiftCardFace } from '@/components/gift/GiftCardFace';
import { designsSync, inSeason } from '@/lib/gift-designs';

const money = (n: number) => `$${n.toFixed(2)}`;
const field = 'h-11 w-full rounded-xl border px-3 text-[15px]';
const fs = { borderColor: 'hsl(var(--border))', background: 'var(--card, #fff)' } as const;
const muted = { color: 'var(--muted, #6d7075)' } as const;

export function GiftCardPanel({ tenantId, clientId, clientName, owedBeforeGift, applied, setApplied, holdId, addGiftCardToCart, brandName, brandLogo, brandAccent, screen, script, services, offer }: {
  offer?: { name: string; tiers: { buyCents: number; bonusCents: number }[] } | null;   // an offer running at the desk (lib/gift-offers)
  services?: { id: string; name: string; price: number }[];   // sell one service as a gift (when the business allows it)
  script?: string | null;   // the one line to say when selling one (lib/gift-designs deskScript)
  brandName?: string | null; brandLogo?: string | null; brandAccent?: string | null;
  screen?: { connected: boolean; ask: (kind: string, extra?: any) => Promise<string | null>; response: any } | null;
  tenantId: string; clientId: string | null; clientName?: string | null; owedBeforeGift: number;
  applied: { id: string; code: string; cents: number; label?: string | null }[]; setApplied: (v: any) => void; holdId: string;
  addGiftCardToCart: (x: { amount: number; gift: any }) => void;
}) {
  const [tab, setTab] = React.useState<'' | 'pay' | 'sell'>(''); const [cards, setCards] = React.useState<any[]>([]);
  const [code, setCode] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  React.useEffect(() => { if (!clientId) { setCards([]); return; } payPost('/api/gift-cards', { tenantId, action: 'forClient', clientId }).then((r) => { if (r.ok) { setCards(r.cards); if (r.cards.length && !applied.length) setTab('pay'); } }); }, [tenantId, clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  const usedCents = applied.reduce((s, g) => s + g.cents, 0); const leftCents = Math.max(0, Math.round(owedBeforeGift * 100) - usedCents);
  const apply = async (c: { id?: string; code?: string }, want?: number): Promise<number> => {
    const ask = want ?? leftCents; if (ask <= 0) { setErr('Nothing left to pay on this sale.'); return 0; }
    setBusy(true); setErr(''); const r = await payPost('/api/gift-cards', { tenantId, action: 'hold', ...c, holdId, cents: ask }); setBusy(false);
    if (!r.ok) { setErr(r.error || 'That gift card didn’t work.'); return 0; }
    if (applied.some((x) => x.id === r.card.id)) return 0;
    (setApplied as any)((prev: any[]) => prev.some((x: any) => x.id === r.card.id) ? prev : [...prev, { id: r.card.id, code: r.card.code, cents: r.cents, label: r.card.ownerName ? `${r.card.ownerName}’s card — pays only for their services` : r.card.recipientName ? `${r.card.purchaserName ? `From ${String(r.card.purchaserName).split(' ')[0]}` : r.card.recipientName}` : null }]); setCode('');
    return Number(r.cents) || 0;
  };
  // Asked on the client screen: they chose to use it (→ apply) or save it for later.
  const [askUse, setAskUse] = React.useState<string | null>(null);
  React.useEffect(() => { const r = screen?.response; if (!askUse || !r || r.requestId !== askUse || r.kind !== 'giftuse') return; setAskUse(null);
    if (r.use) { (async () => { let left = leftCents; for (const c of cards) { if (left <= 0) break; left -= await apply({ id: c.id }, left); } })(); } else setErr('They’d like to save their gift card for another time.'); }, [screen?.response?.requestId]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async (id: string) => { setApplied(applied.filter((x) => x.id !== id)); await payPost('/api/gift-cards', { tenantId, action: 'hold', id, holdId, cents: 0 }).catch(() => {}); };

  // Sell
  const [amt, setAmt] = React.useState(50); const [other, setOther] = React.useState(''); const [to, setTo] = React.useState(''); const [note, setNote] = React.useState('');
  const [via, setVia] = React.useState<'text' | 'email' | 'print' | 'code'>('text'); const [phone, setPhone] = React.useState(''); const [email, setEmail] = React.useState(''); const [later, setLater] = React.useState(''); const [forSelf, setForSelf] = React.useState(false);
  const designs = React.useMemo(() => { const all = designsSync().filter((d) => inSeason(d)); return [...all.filter((d) => d.collection === 'Occasions' && d.season), ...all.filter((d) => !(d.collection === 'Occasions' && d.season))]; }, []);
  const [design, setDesign] = React.useState('frost'); const dz = designs.find((d) => d.id === design);
  const [line, setLine] = React.useState<string | null>(null); const [sendAtIso, setSendAtIso] = React.useState<string | null>(null);
  // "Let them fill it in": the client screen shows the card; they pick the design, the line, a note and when it arrives.
  const [askId, setAskId] = React.useState<string | null>(null); const [filled, setFilled] = React.useState(false);
  React.useEffect(() => { const r = screen?.response; if (!askId || !r || r.requestId !== askId || r.kind !== 'gift') return;
    if (r.design) setDesign(r.design); setLine(r.line ?? null); if (r.message) setNote(r.message); setSendAtIso(r.sendAt || null); if (r.sendAt) setLater(String(r.sendAt).slice(0, 10)); setAskId(null); setFilled(true); }, [screen?.response?.requestId]); // eslint-disable-line react-hooks/exhaustive-deps
  const brand = { name: brandName || 'Gift card', logo: brandLogo || null, accent: brandAccent || null };
  const [svcId, setSvcId] = React.useState(''); const svc = (services || []).find((x) => x.id === svcId) || null;
  const amount = svc ? svc.price : other ? Number(other) : amt;
  const bonusOn = (d: number) => { let b = 0; for (const t of offer?.tiers || []) if (Math.round(d * 100) >= t.buyCents) b = t.bonusCents; return b / 100; }; const okAmt = amount >= 1 && amount <= 5000;
  const okSend = via === 'text' ? phone.replace(/\D/g, '').length >= 10 : via === 'email' ? /\S+@\S+\.\S+/.test(email) : true;
  const sell = () => { addGiftCardToCart({ amount, gift: { recipientName: forSelf ? clientName || null : to.trim() || null, recipientId: forSelf ? clientId : null, recipientPhone: via === 'text' ? phone : null, recipientEmail: via === 'email' ? email : null, message: note.trim() || null, design, line: line === null ? (svc ? svc.name.slice(0, 30) : dz?.line || null) : line || null, service: svc ? { id: svc.id, name: svc.name } : null, sendVia: via, sendAt: sendAtIso && later === sendAtIso.slice(0, 10) ? sendAtIso : later ? new Date(`${later}T10:00:00`).toISOString() : null } });
    setTab(''); setTo(''); setNote(''); setDesign('frost'); setLine(null); setSendAtIso(null); setFilled(false); setPhone(''); setEmail(''); setLater(''); setOther(''); };

  return (
    <section className="space-y-3 rounded-[20px] p-4" style={{ background: 'var(--card, #fff)', border: '1px solid var(--line, hsl(var(--border)))' }} aria-label="Gift cards">
      <div className="flex items-center justify-between gap-2"><p className="text-[15px] font-semibold">Gift cards</p>
        <div className="flex gap-1.5">{(['pay', 'sell'] as const).map((k) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(tab === k ? '' : k)} className="h-9 rounded-full px-3.5 text-[13.5px] font-semibold" style={tab === k ? { background: 'var(--ink, #16171a)', color: '#fff' } : { background: 'var(--soft, #f3f3f5)' }}>{k === 'pay' ? 'Pay with one' : 'Sell one'}</button>)}</div></div>
      {/* The client has gift cards: say so up front, with one tap to use them (or ask them on the client screen). */}
      {cards.length > 0 && !applied.length && leftCents > 0 && (() => { const total = cards.reduce((t, c) => t + (c.availableCents || 0), 0); const first = cards[0]; const nm = clientName ? String(clientName).split(' ')[0] : 'They';
        const useAll = async () => { let left = leftCents; for (const c of cards) { if (left <= 0) break; left -= await apply({ id: c.id }, left); } };
        return (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl p-3" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent, #7c3aed) 9%, #fff), var(--card, #fff))', border: '1px solid color-mix(in srgb, var(--accent, #7c3aed) 18%, transparent)' }}>
            <GiftCardFace design={first.design} brand={{ name: brandName || 'Gift card', logo: brandLogo || null, accent: brandAccent || null }} amount={money(first.availableCents / 100).replace('.00', '')} name={first.recipientName || clientName || ' '} line={first.line || ''} width={112} />
            <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold">{nm} {cards.some((c) => c.mine) ? 'has' : 'bought'} {money(total / 100).replace('.00', '')} on {cards.length > 1 ? `${cards.length} gift cards` : 'a gift card'}</p>
              <p className="text-[12.5px]" style={muted}>{first.kind === 'service' ? `For a ${first.serviceName} · ` : ''}{first.purchaserName && first.mine ? `From ${String(first.purchaserName).split(' ')[0]} · ` : ''}{first.code}</p></div>
            <div className="flex shrink-0 gap-1.5">
              {screen?.connected && <button type="button" disabled={busy || !!askUse} onClick={async () => { const id = await screen.ask('giftuse', { cards: cards.slice(0, 3).map((c) => ({ id: c.id, design: c.design || null, line: c.line || null, cents: c.availableCents, from: c.purchaserName || null, last4: String(c.code || '').slice(-4) })), clientFirst: nm }); if (id) setAskUse(id); }} className="h-10 rounded-full px-3.5 text-[13.5px] font-semibold" style={{ background: 'var(--card, #fff)', border: '1px solid var(--line, hsl(var(--border)))' }}>{askUse ? 'Asking…' : 'Ask them'}</button>}
              <button type="button" disabled={busy} onClick={useAll} className="h-10 rounded-full px-4 text-[14px] font-semibold" style={{ background: 'var(--ink, #16171a)', color: '#fff' }}>Use it</button></div>
          </div>); })()}
      {applied.map((g) => <div key={g.id} className="flex items-center justify-between gap-2 rounded-2xl p-3" style={{ background: 'color-mix(in srgb, var(--ok, #1f7a4d) 9%, transparent)' }}>
        <span className="text-[14px]"><b>Gift card {g.code}</b>{g.label ? <span style={muted}> · {g.label}</span> : null} — <b>−{money(g.cents / 100)}</b></span>
        <button type="button" onClick={() => remove(g.id)} className="shrink-0 text-[13px] font-semibold underline underline-offset-4">Remove</button></div>)}
      {tab === 'pay' && <div className="space-y-2">
        {cards.filter((c) => !applied.some((a) => a.id === c.id)).map((c) => <button key={c.id} type="button" disabled={busy} onClick={() => apply({ id: c.id })} className="flex w-full items-center justify-between gap-2 rounded-2xl p-3 text-left disabled:opacity-50" style={{ background: 'var(--soft, #f3f3f5)' }}>
          <span><span className="block text-[14.5px] font-semibold">{money(c.availableCents / 100)} left{c.purchaserName && !c.mine ? '' : c.purchaserName ? ` · from ${String(c.purchaserName).split(' ')[0]}` : ''}</span><span className="block text-[12.5px]" style={muted}>{c.code}{!c.mine ? ' · they bought this one' : ''}</span></span>
          <span className="shrink-0 text-[13.5px] font-semibold">Use</span></button>)}
        <div className="flex gap-2"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) apply({ code }); }} placeholder="Type or scan a gift card code" aria-label="Gift card code" autoCapitalize="characters" className={field} style={fs} />
          <button type="button" disabled={busy || !code.trim()} onClick={() => apply({ code })} className="h-11 shrink-0 rounded-full px-4 text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--ink, #16171a)', color: '#fff' }}>{busy ? '…' : 'Apply'}</button></div>
        {err && <p className="text-[13.5px] font-semibold" style={{ color: 'var(--warn, #b42318)' }}>{err}</p>}
      </div>}
      {tab === 'sell' && <div className="space-y-3">
        <div className="grid grid-cols-5 gap-1.5">{[25, 50, 75, 100].map((v) => <button key={v} type="button" onClick={() => { setAmt(v); setOther(''); setSvcId(''); }} className="h-11 rounded-xl text-[15px] font-semibold" style={!svc && !other && amt === v ? { background: 'var(--ink, #16171a)', color: '#fff' } : { border: '1px solid var(--line, hsl(var(--border)))', background: 'var(--card, #fff)' }}>${v}</button>)}
          <input value={other} onChange={(e) => { setOther(e.target.value.replace(/[^0-9.]/g, '')); setSvcId(''); }} inputMode="decimal" placeholder="$ other" aria-label="Other amount" className="h-11 rounded-xl border px-2 text-center text-[14px]" style={fs} /></div>
        {offer && !svc && <p className="rounded-2xl px-3.5 py-2.5 text-[13.5px]" style={{ background: 'color-mix(in srgb, #1f7a4d 11%, transparent)', color: 'var(--ok-ink)' }}><b>{offer.name}:</b> {bonusOn(amount) > 0 ? `${clientName ? String(clientName).split(' ')[0] : 'the buyer'} gets ${money(bonusOn(amount)).replace('.00', '')} for themselves with this card.` : `buy ${money(offer.tiers[0].buyCents / 100).replace('.00', '')} or more and they get ${money(offer.tiers[0].bonusCents / 100).replace('.00', '')} for themselves.`}</p>}
        {!!services?.length && <select value={svcId} onChange={(e) => { setSvcId(e.target.value); setLine(null); }} aria-label="Or gift a service" className={field} style={fs}><option value="">Or gift a service — covered even if the price goes up</option>{services.map((x) => <option key={x.id} value={x.id}>{x.name} · {money(x.price).replace('.00', '')}</option>)}</select>}
        <div><p className="mb-1.5 text-[13px] font-semibold" style={muted}>Design{dz ? ` — ${dz.name}` : ''}</p>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">{designs.map((d) => <button key={d.id} type="button" aria-pressed={design === d.id} aria-label={d.name} onClick={() => { setDesign(d.id); setLine(null); }} className="shrink-0 rounded-[9px] p-[2px]" style={{ outline: design === d.id ? '2px solid var(--ink, #16171a)' : 'none', outlineOffset: 1 }}><GiftCardFace design={d} brand={brand} amount={okAmt ? money(amount).replace('.00', '') : '$'} name=" " width={104} /></button>)}</div></div>
        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={forSelf} onChange={(e) => setForSelf(e.target.checked)} className="h-4 w-4" /> It’s for {clientName ? String(clientName).split(' ')[0] : 'them'} themselves</label>
        {!forSelf && <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Who it’s for" aria-label="Who it’s for" className={field} style={fs} />}
        <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 400))} placeholder="A note to them (optional)" aria-label="A note" className={field} style={fs} />
        <div className="flex flex-wrap gap-1.5">{([['text', 'Text it'], ['email', 'Email it'], ['print', 'Print a card'], ['code', 'Just the code']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setVia(k)} className="h-9 rounded-full px-3.5 text-[13.5px] font-semibold" style={via === k ? { background: 'var(--ink, #16171a)', color: '#fff' } : { background: 'var(--soft, #f3f3f5)' }}>{l}</button>)}</div>
        {via === 'text' && <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Their mobile number" aria-label="Their mobile number" className={field} style={fs} />}
        {via === 'email' && <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="Their email" aria-label="Their email" className={field} style={fs} />}
        {(via === 'text' || via === 'email') && <label className="flex items-center gap-2 text-[13.5px]" style={muted}>Send on <input type="date" value={later} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setLater(e.target.value)} className="h-9 rounded-lg border px-2 text-[13.5px]" style={fs} /> {later ? <button type="button" onClick={() => setLater('')} className="underline">today instead</button> : '(or leave for right away)'}</label>}
        {screen?.connected && (askId
          ? <div className="flex items-center justify-between gap-2 rounded-2xl p-3 text-[14px]" style={{ background: 'var(--soft, #f3f3f5)' }}><span>Waiting for them on the client screen…</span><button type="button" onClick={() => { setAskId(null); screen.ask('idle', { soft: true }); }} className="text-[13px] font-semibold underline underline-offset-4">Cancel</button></div>
          : <button type="button" disabled={!okAmt} onClick={async () => { setFilled(false); const id = await screen.ask('gift', { amount, to: forSelf ? clientName || null : to.trim() || null, via, design, designs: designs.slice(0, 24).map((d) => d.id) }); if (id) setAskId(id); else setErr('The client screen didn’t answer — check it’s on.'); }} className="h-11 w-full rounded-full text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--soft, #f3f3f5)' }}>Let them fill it in on the client screen</button>)}
        {filled && <p className="text-[13.5px] font-semibold" style={{ color: 'var(--ok, #1f7a4d)' }}>Filled in on the client screen{sendAtIso ? ` — arrives ${new Date(sendAtIso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}. Check it, then add it.</p>}
        {err && tab === 'sell' && <p className="text-[13.5px] font-semibold" style={{ color: 'var(--warn, #b42318)' }}>{err}</p>}
        <button type="button" disabled={!okAmt || !okSend || (!forSelf && !to.trim() && via !== 'code')} onClick={sell} className="h-11 w-full rounded-full text-[14.5px] font-semibold disabled:opacity-40" style={{ background: 'var(--ink, #16171a)', color: '#fff' }}>{svc ? `Add a gift card for ${svc.name} to the sale` : `Add a ${okAmt ? money(amount).replace('.00', '') : ''} gift card to the sale`}</button>
        {script && <p className="text-[13px]" style={muted}>Say: “{script}”</p>}
      </div>}
    </section>);
}
