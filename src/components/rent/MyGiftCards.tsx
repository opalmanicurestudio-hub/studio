'use client';
// src/components/rent/MyGiftCards.tsx — GIFT CARDS IN THE RENTER PORTAL (portal action gift-*; the studio decides in
// Gift cards → Renters). Take a gift card for a service (a studio card is credited against your next rent; your own
// card is money you already have), sell your own (paid to you, used only with you) and sell them on your booking page.
import * as React from 'react';
import { Gift } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionTitle } from '@/components/rent/shared';
import { api } from '@/components/rent/studio';
import { GiftCardFace } from '@/components/gift/GiftCardFace';
import { designsSync, inSeason } from '@/lib/gift-designs';

const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const inp = 'h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-bold';
const lab = 'text-[9px] font-black uppercase tracking-widest text-slate-400';

/** Take a gift card for a service — used here and on an appointment ("Paid with a gift card"). */
export function TakeGiftCard({ tenantId, token, appointmentId, defaultCents, onDone }: { tenantId: string; token: string; appointmentId?: string | null; defaultCents?: number; onDone?: (msg: string) => void }) {
  const [code, setCode] = React.useState(''); const [card, setCard] = React.useState<any>(null); const [amt, setAmt] = React.useState(defaultCents ? String(defaultCents / 100) : '');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(''); const [ok, setOk] = React.useState('');
  const check = async () => { setBusy(true); setErr(''); setCard(null); const r = await api({ action: 'gift-check', tenantId, token, code }); setBusy(false); if (!r?.ok) { setErr(r?.error || 'That didn’t work.'); return; } setCard(r.card);
    if (defaultCents) setAmt(String(Math.min(defaultCents, r.card.availableCents) / 100)); };
  const take = async () => { const cents = Math.round(Number(amt) * 100); setBusy(true); setErr(''); const r = await api({ action: 'gift-accept', tenantId, token, code, cents, appointmentId: appointmentId || null }); setBusy(false);
    if (!r?.ok) { setErr(r?.error || 'That didn’t work.'); return; }
    const msg = `${money(r.cents)} taken${r.studio ? ' — credited against your next rent' : ''}. ${money(r.balanceAfter)} left on the card.`; setOk(msg); setCard(null); setCode(''); onDone?.(msg); };
  return (
    <div className="space-y-2">
      <div className="flex gap-2"><input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setCard(null); }} placeholder="Gift card code" aria-label="Gift card code" autoCapitalize="characters" className={cn(inp, 'font-mono tracking-widest')} />
        <button type="button" disabled={busy || code.replace(/[^A-Z0-9]/gi, '').length < 4} onClick={check} className="h-11 shrink-0 rounded-xl bg-slate-900 px-4 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy && !card ? '…' : 'Check'}</button></div>
      {card && <div className="space-y-2 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3">
        <p className="text-[12px] font-bold text-emerald-900">{money(card.availableCents)} on this card{card.studio ? ' · a studio card — the studio credits it against your rent' : ' · your own card'}</p>
        <div className="flex gap-2"><input value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="$ amount" aria-label="Amount to take" className={inp} />
          <button type="button" disabled={busy || !(Number(amt) > 0) || Number(amt) * 100 > card.availableCents} onClick={take} className="h-11 shrink-0 rounded-xl bg-emerald-600 px-4 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy ? '…' : `Take $${amt || '0'}`}</button></div>
      </div>}
      {err && <p className="text-[11px] font-bold text-red-700">{err}</p>}
      {ok && <p className="text-[11px] font-bold text-emerald-700">{ok}</p>}
    </div>);
}

export function MyGiftCards({ tenantId, token }: { tenantId: string; token: string }) {
  const [d, setD] = React.useState<any>(null);
  const load = React.useCallback(() => api({ action: 'gift-info', tenantId, token }).then((r) => setD(r?.ok ? r : null)), [tenantId, token]);
  React.useEffect(() => { load(); }, [load]);
  const designs = React.useMemo(() => designsSync().filter((x) => inSeason(x)).slice(0, 18), []);
  const [open, setOpen] = React.useState<'' | 'take' | 'sell'>('');
  const [amt, setAmt] = React.useState('50'); const [to, setTo] = React.useState(''); const [buyer, setBuyer] = React.useState(''); const [note, setNote] = React.useState(''); const [design, setDesign] = React.useState('frost');
  const [via, setVia] = React.useState<'text' | 'email' | 'code'>('text'); const [phone, setPhone] = React.useState(''); const [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState<{ ok: boolean; t: string } | null>(null); const [copied, setCopied] = React.useState(false);
  if (!d || (!d.salonCards && !d.ownCards)) return null;
  const brand = { name: d.brand?.name || 'Gift card', accent: d.brand?.accent || null };
  const sell = async () => { setBusy(true); setMsg(null);
    const r = await api({ action: 'gift-sell', tenantId, token, amountCents: Math.round(Number(amt) * 100), recipientName: to, buyerName: buyer, message: note, design, sendVia: via, phone, email }); setBusy(false);
    if (!r?.ok) { setMsg({ ok: false, t: r?.error || 'That didn’t work.' }); return; } setMsg({ ok: true, t: `Gift card ${r.card.code} made${via === 'code' ? ' — give them the code' : ` and ${via === 'text' ? 'texted' : 'emailed'}`}.` }); setTo(''); setNote(''); setPhone(''); setEmail(''); load(); };
  const online = async (on: boolean) => { const r = await api({ action: 'gift-online', tenantId, token, on }); if (!r?.ok) setMsg({ ok: false, t: r?.error || 'That didn’t work.' }); load(); };
  const link = d.link && typeof window !== 'undefined' ? `${window.location.origin}${d.link}` : '';
  return (
    <section className="space-y-3">
      <SectionTitle icon={Gift}>Gift cards</SectionTitle>
      <div className="space-y-3 rounded-3xl border-2 border-slate-100 bg-white p-4">
        <p className="text-[11px] font-medium text-slate-600">{d.salonCards ? 'Clients can pay you with a studio gift card — the studio credits it against your next rent. ' : ''}{d.ownCards ? 'You can sell your own gift cards too — paid to you, used only with you.' : ''}</p>
        <div className="flex gap-2">
          <button type="button" aria-pressed={open === 'take'} onClick={() => setOpen(open === 'take' ? '' : 'take')} className={cn('h-10 flex-1 rounded-xl text-[10px] font-black uppercase tracking-widest', open === 'take' ? 'bg-slate-900 text-white' : 'border-2 border-slate-200 text-slate-700')}>Take a gift card</button>
          {d.ownCards && <button type="button" aria-pressed={open === 'sell'} onClick={() => setOpen(open === 'sell' ? '' : 'sell')} className={cn('h-10 flex-1 rounded-xl text-[10px] font-black uppercase tracking-widest', open === 'sell' ? 'bg-slate-900 text-white' : 'border-2 border-slate-200 text-slate-700')}>Sell one</button>}
        </div>
        {open === 'take' && <TakeGiftCard tenantId={tenantId} token={token} onDone={() => load()} />}
        {open === 'sell' && <div className="space-y-2.5">
          <div className="flex justify-center py-1"><GiftCardFace design={design} brand={brand} amount={`$${amt || '0'}`} name={to || 'Their name'} width={280} /></div>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">{designs.map((x) => <button key={x.id} type="button" aria-pressed={design === x.id} aria-label={x.name} onClick={() => setDesign(x.id)} className="shrink-0 rounded-[8px] p-[2px]" style={{ outline: design === x.id ? '2px solid #0f172a' : 'none' }}><GiftCardFace design={x} brand={brand} amount="" name=" " width={84} /></button>)}</div>
          <div className="grid grid-cols-4 gap-1.5">{['25', '50', '75', '100'].map((v) => <button key={v} type="button" onClick={() => setAmt(v)} className={cn('h-10 rounded-xl text-sm font-black', amt === v ? 'bg-slate-900 text-white' : 'border-2 border-slate-200')}>${v}</button>)}</div>
          <input value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" aria-label="Amount" placeholder="$ other amount" className={inp} />
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Who it’s for" aria-label="Who it’s for" className={inp} />
          <input value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="Who’s buying it" aria-label="Who’s buying it" className={inp} />
          <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 400))} placeholder="A note (optional)" aria-label="A note" className={inp} />
          <div className="flex gap-1.5">{([['text', 'Text it'], ['email', 'Email it'], ['code', 'Just the code']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setVia(k)} className={cn('h-9 flex-1 rounded-xl text-[10px] font-black uppercase tracking-widest', via === k ? 'bg-slate-900 text-white' : 'border-2 border-slate-200 text-slate-700')}>{l}</button>)}</div>
          {via === 'text' && <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Their mobile number" aria-label="Their mobile number" className={inp} />}
          {via === 'email' && <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="Their email" aria-label="Their email" className={inp} />}
          <p className={lab}>Take the money yourself (cash, your reader) — this records the card; the studio isn’t paid.</p>
          <button type="button" disabled={busy || !(Number(amt) >= 1) || (via === 'text' && phone.replace(/\D/g, '').length < 10) || (via === 'email' && !/\S+@\S+\.\S+/.test(email))} onClick={sell} className="h-11 w-full rounded-xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40">{busy ? '…' : `Make a $${amt || '0'} gift card`}</button>
        </div>}
        {d.ownCards && <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2"><span className="text-[11px] font-black uppercase tracking-widest text-slate-800">Sell on my booking page</span>
            <button type="button" role="switch" aria-checked={d.online} disabled={!d.canTakeCards && !d.online} onClick={() => online(!d.online)} className={cn('relative h-7 w-12 rounded-full transition-colors disabled:opacity-40', d.online ? 'bg-emerald-600' : 'bg-slate-300')}><span className="absolute top-1 h-5 w-5 rounded-full bg-white transition-all" style={{ left: d.online ? 24 : 4 }} /></button></div>
          {!d.canTakeCards && <p className="text-[10px] font-bold text-slate-500">Connect your card payments first — buyers pay you directly.</p>}
          {d.online && link && <div className="flex gap-2"><input readOnly value={link} aria-label="Your gift card link" className={cn(inp, 'font-mono text-[11px]')} /><button type="button" onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="h-11 shrink-0 rounded-xl border-2 border-slate-200 px-3 text-[10px] font-black uppercase tracking-widest">{copied ? 'Copied' : 'Copy'}</button></div>}
        </div>}
        {msg && <p className={cn('text-[11px] font-bold', msg.ok ? 'text-emerald-700' : 'text-red-700')}>{msg.t}</p>}
        {(d.cards || []).length > 0 && <div className="space-y-1.5"><p className={lab}>Your gift cards</p>
          {d.cards.slice(0, 20).map((c: any) => <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border-2 border-slate-100 px-3 py-2">
            <span className="min-w-0"><span className="block font-mono text-[12px] font-bold">{c.code}</span><span className="block truncate text-[10px] font-bold text-slate-500">{c.recipientName ? `For ${c.recipientName}` : 'Not linked'}{c.sendAt ? ` · sends ${new Date(c.sendAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</span></span>
            <span className="shrink-0 text-right text-[12px] font-black">{money(c.balanceCents)}<span className="block text-[9px] font-bold text-slate-400">of {money(c.initialCents)}</span></span></div>)}</div>}
      </div>
    </section>);
}
