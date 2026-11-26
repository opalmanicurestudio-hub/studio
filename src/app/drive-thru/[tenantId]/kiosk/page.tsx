'use client';
// src/app/drive-thru/[tenantId]/kiosk/page.tsx — THE KIOSK (design canvas "Self-order kiosk"; lib/kiosk, api/kiosk): a
// tablet by the door with the card reader beside it. Guests tap Start, pick from the menu (photos, choices, prices and
// offers as at the counter), review, pay on the reader, and get a number to watch for. The kitchen gets the order only
// once it's paid; an order left here is let go and what it held goes back on the shelf.
//   Set up once by a manager (api/kitchen 'pair', kind 'kiosk'), who then picks its card reader (signed in, or later with
//   their PIN under Team). Its key only takes this kiosk's orders and payments. Nothing is kept on the tablet but the
//   key: the order lives in the page, and starts over by itself when it's left alone.
//   Laid out like a cafe's menu board (design canvas "Self-order kiosk options", B): sections down the side, what's
//   featured shown big, the menu as a list with pictures, and the order kept like a receipt; in the business's own color.
//   In English or Español (lib/guest-lang; design board "The boards and the assistant in Spanish"): each guest picks on
//   the start screen, and it goes back to the kiosk's own (?lang=es in its address, kept on the tablet) for the next.
//   The business's names and descriptions in its own Spanish where it has some; choices as it wrote them. What the team
//   sees (Team, the card reader) stays in English.

import * as React from 'react';
import { useParams } from 'next/navigation';
import { Check, Minus, Plus, X } from 'lucide-react';
import { ScreenSetup } from '@/components/drive-thru/ScreenSetup';
import { PinPad } from '@/components/kitchen/PinPad';
import { ChoicePicker } from '@/components/menu/ChoicePicker';
import { AllergyChips, NoteField, NO_ALLERGY, allergyBody, hasAllergy, type AllergyValue } from '@/components/menu/OrderAllergy';
import { conflictWords, containsLine, dishConflict, sameNote } from '@/lib/order-allergy';
import type { AllergenKey } from '@/lib/allergens';
import { choiceGroups, defaultPicks, priceChoices, type Picks } from '@/lib/menu-choices';
import { offersFor, sizedUp, type OfferKind, type SizeUp } from '@/lib/menu-upgrades';
import { GUEST_LANGS, cleanGuestLang, gt, guestLangKey, inLang, sayIn, type GuestLang } from '@/lib/guest-lang';

// (Muted and amber a shade deeper than elsewhere in the app: they sit on a wash of the business's color here, and
// still read at 4.5:1 on it.)
const INK = '#16171a', MUTED = '#5b5f65', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d', GREEN_TINT = '#ecf6f0', AMBER = '#92400e', AMBER_TINT = '#fff7ed';
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `inline-flex items-center justify-center gap-2 rounded-2xl px-5 font-semibold disabled:opacity-40 ${RING}`;
/** A button on the business's color: a white ring, set off by that color. */
const btnOn = btn.replace(RING, 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2');
const ringOn = (a: string) => ({ ['--tw-ring-offset-color' as any]: a }) as React.CSSProperties;
const dark = { background: INK, color: '#fff' }, quiet = { background: '#fff', color: INK, border: `1px solid ${LINE}` };
/** Untouched this long, it asks "Still ordering?", and starts over this long after that. Paying, it waits longer. */
const IDLE_MS = 60000, ASK_MS = 15000, PAY_IDLE_MS = 120000, PAID_MS = 20000, POLL_MS = 2000;
const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
const keyName = (t: string) => `cf.drivethru.kiosk.${t}`;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12))).map((x) => x.toString(16).padStart(2, '0')).join('');

type Item = { id: string; name: string; nameEs?: string | null; wordsEs?: string | null; section: string; words: string | null; price: number; happy?: boolean; from: boolean; startPrice: number; imageUrl: string | null; choices: any[]; soldOut: boolean; calories?: number | null; upgrades?: { size: boolean; items: string[] }; featured?: boolean; badge?: 'new' | 'limited' | null;
  /** What it contains of the major allergens, when the business has said (null: nobody has). */
  allergens?: AllergenKey[] | null };
type Menu = { business: string; payments: boolean; reader: boolean; testReader?: boolean; askToGo: boolean; taxPct: number; sections: { name: string; nameEs?: string | null; items: Item[] }[]; accent?: string | null;
  /** "Text me when it's ready" offered on the paid screen (lib/ready-text). */
  texts?: boolean };
/** The business's own color (white type reads on it) and a pale wash of it for grounds. */
const HEX = /^#[0-9a-f]{6}$/i;
const tintOf = (hex: string) => { const n = parseInt(hex.slice(1), 16); return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * 0.1 + 255 * 0.9).toString(16).padStart(2, '0')).join(''); };
const Accent = React.createContext(INK);
type Line = { key: string; itemId: string; name: string; picks: Picks; choicesText: string; quantity: number; each: number; offer?: OfferKind; note?: string };
/** Right after something's added: what's offered with it (kept as first shown), and what's been taken. */
type After = { key: string; itemId: string; name: string; qty: number; size: SizeUp | null; items: Item[]; took: string[] };
type Placed = { orderId: string; number: string; total: number; lines: { name: string; nameEs?: string | null; quantity: number; choicesText: string | null; price: number }[] };
type Say = (en: string, v?: Record<string, string | number>) => string;
type Paying = { state: 'starting' | 'on_reader' | 'declined' | 'trouble'; message?: string | null };
type Reader = { id: string; label: string; online: boolean; test: boolean };

async function call(body: any) {
  try { const r = await fetch('/api/kiosk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, d: await r.json().catch(() => ({})) }; }
  catch { return { status: 0, d: { ok: false, error: 'No connection. Try again.' } }; }
}
const pickWords = (item: Item, picks: Picks) => { const p = priceChoices(item, picks); return p.ok ? p.text : ''; };

function Modal({ label, onClose, children, wide, side }: { label: string; onClose?: () => void; children: React.ReactNode; wide?: boolean; side?: boolean }) {
  const box = React.useRef<HTMLDivElement>(null); const close = React.useRef(onClose); close.current = onClose;
  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; (box.current?.querySelector<HTMLElement>('[data-start]:not([disabled])') || box.current?.querySelector<HTMLElement>('button'))?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current?.(); }; document.addEventListener('keydown', k);
    return () => { document.removeEventListener('keydown', k); opener?.focus?.(); };
  }, []);
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${side ? 'lg:items-stretch lg:justify-end lg:p-0' : ''}`} style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={label} className={`flex max-h-[92dvh] w-full flex-col rounded-3xl bg-[#fff] text-left ${wide ? 'max-w-2xl' : 'max-w-md'} ${side ? 'lg:max-h-none lg:max-w-[640px] lg:rounded-none lg:rounded-l-[28px]' : ''}`} style={{ color: INK }}>{children}</div>
    </div>
  );
}

/** A 10-digit number as it's typed: (555) 014-2222. */
const phoneWords = (d: string) => (d.length <= 3 ? `(${d}` : d.length <= 6 ? `(${d.slice(0, 3)}) ${d.slice(3)}` : `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`);

/** "Text me when it's ready", after paying: a number pad (bigger and surer than the tablet's keyboard at arm's length),
 *  and one text for this order when it's ready (lib/ready-text). The number isn't kept here. */
function TextMe({ tenantId, kioskKey, orderId, onDone, onClose, lang }: { tenantId: string; kioskKey: string; orderId: string; onDone: (last4: string, sent: boolean) => void; onClose: () => void; lang: GuestLang }) {
  const A = React.useContext(Accent); const t: Say = (en, v) => gt(lang, en, v);
  const [digits, setDigits] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const press = (k: string) => { setErr(''); setDigits((d) => (k === 'back' ? d.slice(0, -1) : k === 'clear' ? '' : d.length >= 10 ? d : d + k)); };
  const save = async () => {
    setBusy(true); setErr('');
    const { d } = await call({ action: 'textMe', tenantId, key: kioskKey, orderId, phone: digits });
    setBusy(false);
    if (d.ok) onDone(String(d.last4 || digits.slice(-4)), !!d.sent); else setErr(sayIn(lang, d.error, 'That didn’t go through. Try again.'));
  };
  return (
    <Modal label={t('Text me when it’s ready')} onClose={onClose}>
      <div className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[22px] font-semibold tracking-tight">{t('Your mobile number')}</h2>
          <button type="button" onClick={onClose} aria-label={t('Close')} className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${RING}`} style={{ background: SOFT }}><X className="h-5 w-5" aria-hidden /></button>
        </div>
        <p className="flex min-h-[60px] items-center justify-center rounded-2xl text-[28px] font-semibold tabular-nums" style={{ border: `1px solid ${LINE}` }}>
          <output aria-live="polite">{digits ? phoneWords(digits) : <span className="text-[17px] font-normal" style={{ color: MUTED }}>{t('Ten digits')}</span>}</output></p>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('Number pad')}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'].map((k) => (
            <button key={k} type="button" onClick={() => press(k)} disabled={busy || ((k === 'back' || k === 'clear') && !digits) || (/\d/.test(k) && digits.length >= 10)}
              aria-label={k === 'back' ? t('Delete the last digit') : k === 'clear' ? t('Clear the number') : undefined}
              className={`${btn} min-h-[64px] ${/\d/.test(k) ? 'text-[26px]' : 'text-[16px]'}`} style={{ background: SOFT, color: INK }}>{k === 'back' ? t('Delete') : k === 'clear' ? t('Clear') : k}</button>))}
        </div>
        {err && <p role="alert" className="text-[15px]" style={{ color: AMBER }}>{err}</p>}
        <button type="button" data-start disabled={digits.length !== 10 || busy} onClick={save} className={`${btnOn} min-h-[60px] w-full rounded-full text-[17px]`} style={{ background: A, color: '#fff', ...ringOn(A) }}>{busy ? t('Saving…') : t('Text me')}</button>
        <p className="text-center text-[14px]" style={{ color: MUTED }}>{t('One text, just for this order.')}</p>
      </div>
    </Modal>
  );
}

/** "Get a receipt" (design board "Receipts at the counter"; api/kiosk 'receipt'): a text or an email with a private link
 *  to the full receipt, for the order just paid here. What's typed is never kept on the kiosk. */
function ReceiptMe({ tenantId, kioskKey, orderId, onDone, onClose, lang }: { tenantId: string; kioskKey: string; orderId: string; onDone: (words: string) => void; onClose: () => void; lang: GuestLang }) {
  const A = React.useContext(Accent); const t: Say = (en, v) => gt(lang, en, v);
  const [way, setWay] = React.useState<'sms' | 'email'>('sms');
  const [digits, setDigits] = React.useState(''); const [email, setEmail] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const press = (k: string) => { setErr(''); setDigits((d) => (k === 'back' ? d.slice(0, -1) : k === 'clear' ? '' : d.length >= 10 ? d : d + k)); };
  const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready = way === 'sms' ? digits.length === 10 : okEmail;
  const send = async () => {
    if (!ready) return; setBusy(true); setErr('');
    const { d } = await call({ action: 'receipt', tenantId, key: kioskKey, orderId, channel: way, to: way === 'sms' ? digits : email.trim() });
    setBusy(false);
    if (d.ok) onDone(way === 'sms' ? t('Your receipt was texted to ···{n}.', { n: digits.slice(-4) }) : t('Your receipt was emailed.')); else setErr(sayIn(lang, d.error, 'That didn’t go through. Try again.'));
  };
  const tab = (on: boolean) => (on ? { background: INK, color: '#fff' } : { background: SOFT, color: INK });
  return (
    <Modal label={t('Get a receipt')} onClose={onClose}>
      <div className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[22px] font-semibold tracking-tight">{t('Get a receipt')}</h2>
          <button type="button" onClick={onClose} aria-label={t('Close')} className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${RING}`} style={{ background: SOFT }}><X className="h-5 w-5" aria-hidden /></button>
        </div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('Send it by')}>
          <button type="button" aria-pressed={way === 'sms'} onClick={() => { setWay('sms'); setErr(''); }} className={`${btn} min-h-[56px] text-[17px]`} style={tab(way === 'sms')}>{t('Text')}</button>
          <button type="button" aria-pressed={way === 'email'} onClick={() => { setWay('email'); setErr(''); }} className={`${btn} min-h-[56px] text-[17px]`} style={tab(way === 'email')}>{t('Email')}</button>
        </div>
        {way === 'sms' ? <>
          <p className="flex min-h-[60px] items-center justify-center rounded-2xl text-[28px] font-semibold tabular-nums" style={{ border: `1px solid ${LINE}` }}>
            <output aria-live="polite">{digits ? phoneWords(digits) : <span className="text-[17px] font-normal" style={{ color: MUTED }}>{t('Your mobile number')}</span>}</output></p>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('Number pad')}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'].map((k) => (
              <button key={k} type="button" onClick={() => press(k)} disabled={busy || ((k === 'back' || k === 'clear') && !digits) || (/\d/.test(k) && digits.length >= 10)}
                aria-label={k === 'back' ? t('Delete the last digit') : k === 'clear' ? t('Clear the number') : undefined}
                className={`${btn} min-h-[64px] ${/\d/.test(k) ? 'text-[26px]' : 'text-[16px]'}`} style={{ background: SOFT, color: INK }}>{k === 'back' ? t('Delete') : k === 'clear' ? t('Clear') : k}</button>))}
          </div>
        </> : <label className="block text-[15px] font-semibold" style={{ color: MUTED }}>{t('Your email')}
          <input type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => { setErr(''); setEmail(e.target.value.slice(0, 120)); }} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
            className={`mt-2 block min-h-[60px] w-full rounded-2xl px-4 text-[20px] font-normal outline-none ${RING}`} style={{ border: `1px solid ${LINE}`, color: INK, background: '#fff' }} /></label>}
        {err && <p role="alert" className="text-[15px]" style={{ color: AMBER }}>{err}</p>}
        <button type="button" disabled={!ready || busy} onClick={send} className={`${btnOn} min-h-[60px] w-full rounded-full text-[17px]`} style={{ background: A, color: '#fff', ...ringOn(A) }}>{busy ? t('Sending…') : t('Send my receipt')}</button>
        <p className="text-center text-[14px]" style={{ color: MUTED }}>{t('A link to your full receipt. Nothing is kept on this screen.')}</p>
      </div>
    </Modal>
  );
}

function ItemSheet({ item, onAdd, onClose, lang }: { item: Item; onAdd: (picks: Picks, qty: number, note: string) => void; onClose: () => void; lang: GuestLang }) {
  const t: Say = (en, v) => gt(lang, en, v); const name = inLang(lang, item.name, item.nameEs); const words = inLang(lang, item.words || '', item.wordsEs) || null;
  const [picks, setPicks] = React.useState<Picks>(() => defaultPicks(item)); const [qty, setQty] = React.useState(1); const [tried, setTried] = React.useState(false); const [note, setNote] = React.useState('');
  const priced = priceChoices(item, picks); const each = Math.max(0, item.price + (priced.ok ? priced.extra : 0));
  const A = React.useContext(Accent);
  // (In Spanish, what to do: the server's words are English, and the choice's own name is as the business wrote it.)
  const missing = !priced.ok ? choiceGroups(item).find((g) => g.required && !(picks[g.id] || []).length) : undefined;
  const why = priced.ok ? '' : lang === 'en' ? priced.error : t(missing ? 'Choose an option.' : 'Check your choices.');
  return (
    <Modal label={name} onClose={onClose} wide side>
      <div className="flex items-center justify-between gap-3 px-6 pt-6">
        <h2 className="min-w-0 truncate text-[30px] font-bold tracking-tight">{name}</h2>
        <button type="button" onClick={onClose} aria-label={t('Close')} className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${RING}`} style={{ border: `1px solid ${LINE}` }}><X className="h-5 w-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          {item.imageUrl && <img src={item.imageUrl} alt="" className="aspect-[4/3] w-full rounded-2xl object-cover sm:w-56" style={{ background: tintOf(A) }} />}
          {(words || item.calories != null) && <p className="text-[16px] leading-relaxed" style={{ color: MUTED }}>{words}{words && item.calories != null ? ' ' : ''}{item.calories != null && <span className="whitespace-nowrap">{t('({n} cal)', { n: item.calories })}</span>}</p>}
        </div>
        <p className="mt-3 text-[15px]" style={{ color: MUTED }}>{containsLine(item, lang) ? `${containsLine(item, lang)}.${item.choices.length ? ` ${t('Choices can change this.')}` : ''}` : t('Allergens aren’t listed for this one.')}</p>
        <div className="mt-4"><ChoicePicker item={item} picks={picks} onChange={(p) => { setTried(false); setPicks(p); }} lang={lang} /></div>
        <div className="mt-4"><NoteField value={note} onChange={setNote} id={`kiosk-note-${item.id}`} big lang={lang} /></div>
        {!priced.ok && tried && <p role="alert" className="mt-3 text-[15px] font-semibold" style={{ color: AMBER }}>{why}</p>}
      </div>
      <div className="flex items-center gap-3 border-t px-6 py-4" style={{ borderColor: LINE }}>
        <div className="flex shrink-0 items-center rounded-full" style={{ border: `1px solid ${LINE}` }} role="group" aria-label={t('How many')}>
          <button type="button" aria-label={t('One fewer')} disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))} className={`inline-flex h-14 w-14 items-center justify-center rounded-full disabled:opacity-30 ${RING}`}><Minus className="h-5 w-5" /></button>
          <span className="w-8 text-center text-[19px] font-semibold tabular-nums" aria-live="polite">{qty}</span>
          <button type="button" aria-label={t('One more')} disabled={qty >= 20} onClick={() => setQty((n) => Math.min(20, n + 1))} className={`inline-flex h-14 w-14 items-center justify-center rounded-full disabled:opacity-30 ${RING}`}><Plus className="h-5 w-5" /></button>
        </div>
        <button type="button" data-start onClick={() => (priced.ok ? onAdd(picks, qty, note.trim()) : setTried(true))} className={`${btn} min-h-[60px] flex-1 rounded-full text-[18px] tabular-nums`} style={priced.ok ? { background: A, color: '#fff' } : { background: LINE, color: MUTED }}>{qty > 1 ? t('Add {n}, {price}', { n: qty, price: usd(each * qty) }) : t('Add, {price}', { price: usd(each * qty) })}</button>
      </div>
    </Modal>
  );
}

/** The card reader this kiosk takes cards on: a manager picks it (signed in here, or with their PIN). */
function ReaderSheet({ tenantId, kioskKey, onClose, onPicked }: { tenantId: string; kioskKey: string; onClose: () => void; onPicked: () => void }) {
  const [pin, setPin] = React.useState<string | null>(null); const [needPin, setNeedPin] = React.useState(false);
  const [list, setList] = React.useState<{ readers: Reader[]; current: string | null } | null>(null); const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState('');
  React.useEffect(() => { void call({ action: 'readers', tenantId, key: kioskKey }).then(({ d }) => { if (d.ok) setList({ readers: d.readers || [], current: d.current || null }); else if (d.needsManager) setNeedPin(true); else setErr(d.error || 'The card readers couldn’t be listed. Try again.'); }); }, [tenantId, kioskKey]);
  const check = async (p: string) => {
    const { d } = await call({ action: 'readers', tenantId, key: kioskKey, pin: p });
    if (!d.ok) return { ok: false as const, error: d.error || 'That didn’t go through. Try again.' };
    setPin(p); setList({ readers: d.readers || [], current: d.current || null }); return { ok: true as const, staff: { id: '', name: String(d.by || ''), pass: '' } };
  };
  if (needPin && !list) return <PinPad check={check} onDone={() => setNeedPin(false)} onClose={onClose} title="A manager’s PIN" line="It changes the card reader this kiosk takes cards on." />;
  const pick = async (r: Reader) => {
    setBusy(r.id); setErr('');
    const { d } = await call({ action: 'setReader', tenantId, key: kioskKey, readerId: r.id, ...(pin ? { pin } : {}) });
    setBusy('');
    if (d.ok) { setList((l) => (l ? { ...l, current: r.id } : l)); onPicked(); } else setErr(d.error || 'That didn’t go through. Try again.');
  };
  return (
    <Modal label="This kiosk’s card reader" onClose={onClose}>
      <div className="px-6 pt-6"><h2 className="text-[22px] font-semibold tracking-tight">This kiosk’s card reader</h2>
        <p className="mt-1 text-[15px]" style={{ color: MUTED }}>Guests pay on the reader beside this tablet. Pick it here.</p></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {!list && !err && <div className="mx-auto h-7 w-7 animate-spin rounded-full border-[3px]" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading" />}
        {list && !list.readers.length && <p className="text-[15px]" style={{ color: MUTED }}>No card readers yet. Add one under Settings, Payments, then pick it here.</p>}
        {list && list.readers.length > 0 && <ul className="space-y-2">{list.readers.map((r) => { const on = list.current === r.id; return (
          <li key={r.id}><button type="button" disabled={!!busy} onClick={() => pick(r)} aria-pressed={on} className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-2xl px-4 text-left ${RING}`} style={on ? dark : quiet}>
            <span className="min-w-0"><span className="block truncate text-[16px] font-semibold">{r.label}{r.test ? ' (test)' : ''}</span><span className="block text-[13.5px]" style={{ color: on ? '#d6d7da' : r.online ? GREEN : AMBER }}>{r.online ? 'Online' : 'Offline'}</span></span>
            {on ? <Check className="h-5 w-5 shrink-0" aria-hidden /> : busy === r.id ? <span className="text-[14px]">Saving…</span> : null}
          </button></li>); })}</ul>}
        {err && <p role="alert" className="mt-3 text-[15px]" style={{ color: AMBER }}>{err}</p>}
      </div>
      <div className="border-t px-6 py-4" style={{ borderColor: LINE }}><button type="button" data-start onClick={onClose} className={`${btn} min-h-[52px] w-full text-[16px]`} style={dark}>Done</button></div>
    </Modal>
  );
}

export default function KioskScreen() {
  const { tenantId } = useParams() as { tenantId: string };
  const [key, setKey] = React.useState<string | null>(null); const [ready, setReady] = React.useState(false); const [stopped, setStopped] = React.useState('');
  const [menu, setMenu] = React.useState<Menu | null>(null); const [loadErr, setLoadErr] = React.useState(''); const [closed, setClosed] = React.useState('');
  const [step, setStep] = React.useState<'start' | 'menu' | 'review' | 'pay' | 'paid'>('start');
  const [section, setSection] = React.useState(''); const [cart, setCart] = React.useState<Line[]>([]); const [open, setOpen] = React.useState<Item | null>(null);
  const [after, setAfter] = React.useState<After | null>(null); const [passed, setPassed] = React.useState<string[]>([]); const [offered, setOffered] = React.useState(false);
  const [name, setName] = React.useState(''); const [toGo, setToGo] = React.useState<boolean | null>(null);
  // The guest's allergies (lib/order-allergy): on every ticket in the kitchen.
  const [allergy, setAllergy] = React.useState<AllergyValue>(NO_ALLERGY);
  const [placed, setPlaced] = React.useState<Placed | null>(null); const [paying, setPaying] = React.useState<Paying | null>(null); const [paidName, setPaidName] = React.useState('');
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const [ask, setAsk] = React.useState<number | null>(null); const [, setTick] = React.useState(0);
  const [team, setTeam] = React.useState(false); const [leaving, setLeaving] = React.useState(false);
  // "Text me when it's ready" on the paid screen: the number pad open, and once asked, the last four digits.
  const [texting, setTexting] = React.useState(false); const [texted, setTexted] = React.useState<{ last4: string; sent: boolean } | null>(null);
  // "Get a receipt" on the paid screen: the sheet open, and once sent, what to say.
  const [receipting, setReceipting] = React.useState(false); const [receiptSent, setReceiptSent] = React.useState('');
  // The kiosk's own language (?lang=es, or what's kept on the tablet), and the one this guest picked on the start screen.
  const [home, setHome] = React.useState<GuestLang>('en'); const [lang, setLang] = React.useState<GuestLang>('en');
  const t: Say = (en, v) => gt(lang, en, v);
  // (Read aloud in the guest's language.)
  React.useEffect(() => { document.documentElement.lang = lang; return () => { document.documentElement.lang = 'en'; }; }, [lang]);
  const touched = React.useRef(Date.now()); const paidAt = React.useRef(0); const orderKey = React.useRef(''); const checking = React.useRef(false);

  React.useEffect(() => {
    setKey(read(keyName(tenantId)));
    let asked: string | null = null; try { asked = new URLSearchParams(window.location.search).get('lang'); } catch { /* no address */ }
    if (asked) write(guestLangKey('kiosk', tenantId), cleanGuestLang(asked));
    const l = cleanGuestLang(asked || read(guestLangKey('kiosk', tenantId))); setHome(l); setLang(l);
    setReady(true);
  }, [tenantId]);
  const lost = (d: any) => { write(keyName(tenantId), null); setKey(null); setStopped(d?.error || 'This kiosk was stopped. A manager can set it up again.'); };
  const loadMenu = React.useCallback(async () => {
    if (!key) return;
    const { status, d } = await call({ action: 'menu', tenantId, key });
    if (status === 401) { lost(d); return; }
    if (d.closed || status === 403) { setClosed(d.error || 'Ordering here is closed for now. Please order at the counter.'); return; }
    if (d.ok) { setMenu(d); setClosed(''); setLoadErr(''); setSection((s) => (d.sections.some((x: any) => x.name === s) ? s : d.sections[0]?.name || '')); } else setLoadErr(d.error || 'The menu couldn’t be loaded. Try again.');
  }, [tenantId, key]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void loadMenu(); }, [loadMenu]);
  // Between guests the menu is read again every minute (what's sold out, what's on now).
  React.useEffect(() => { if (step !== 'start' || !key) return; const i = setInterval(() => void loadMenu(), 60000); return () => clearInterval(i); }, [step, key, loadMenu]);
  // Any touch counts as still ordering.
  React.useEffect(() => {
    const t = () => { touched.current = Date.now(); setAsk(null); };
    window.addEventListener('pointerdown', t); window.addEventListener('keydown', t);
    return () => { window.removeEventListener('pointerdown', t); window.removeEventListener('keydown', t); };
  }, []);
  // A new order key whenever the order changes after going back: never the old order paid for.
  React.useEffect(() => { orderKey.current = ''; }, [cart, name, toGo, allergy]);

  const byId = React.useMemo(() => new Map((menu?.sections || []).flatMap((s) => s.items.map((i) => [i.id, i] as [string, Item]))), [menu]);
  const count = cart.reduce((n, l) => n + l.quantity, 0); const subtotal = Math.round(cart.reduce((n, l) => n + l.each * l.quantity, 0) * 100) / 100;
  const tax = Math.round(subtotal * (menu?.taxPct || 0)) / 100; const total = Math.round((subtotal + tax) * 100) / 100;

  const startOver = React.useCallback(() => {
    setCart([]); setName(''); setToGo(null); setAllergy(NO_ALLERGY); setPlaced(null); setPaying(null); setAfter(null); setOpen(null); setPassed([]); setOffered(false);
    setErr(''); setAsk(null); setLeaving(false); setPaidName(''); setTexting(false); setTexted(null); setReceipting(false); setReceiptSent(''); orderKey.current = ''; setStep('start'); setLang(home); void loadMenu();
  }, [loadMenu, home]);
  // Let the order go (the reader stops asking; what it held goes back): a card approved at that moment is kept.
  const letGo = React.useCallback(async (then: 'start' | 'review') => {
    if (!placed) { if (then === 'start') startOver(); else setStep('review'); return; }
    setBusy(true);
    const { d } = await call({ action: 'cancel', tenantId, key, orderId: placed.orderId });
    setBusy(false);
    if (d.ok && d.state === 'paid') { paidAt.current = Date.now(); setPaidName(name.trim().split(' ')[0] || ''); setStep('paid'); return; }
    // Not let go (the card still being processed, or no connection): said, and when it was left alone, tried again
    // shortly, so the next guest never finds this order waiting on the reader.
    if (!d.ok) { setErr(sayIn(lang, d.error, 'That didn’t go through. Try again.')); if (then === 'start') { setLeaving(false); setAsk(Date.now()); } return; }
    setPlaced(null); setPaying(null); orderKey.current = '';
    if (then === 'start') startOver(); else { setErr(''); setStep('review'); }
  }, [placed, tenantId, key, name, startOver, lang]);

  // Left alone: "Still ordering?", then it starts over (paying: the order is let go first). The paid screen goes back
  // to the start by itself.
  React.useEffect(() => {
    const i = setInterval(() => {
      setTick((n) => n + 1);
      const now = Date.now();
      // (Typing a number for a text: it waits while they type, and starts over if they walk away mid-number.)
      if (step === 'paid') { if (texting || receipting ? now - touched.current > IDLE_MS : now - paidAt.current > PAID_MS) startOver(); return; }
      if (step === 'start' || open || team) return;
      const limit = step === 'pay' ? PAY_IDLE_MS : IDLE_MS;
      if (ask === null) { if (now - touched.current > limit) setAsk(now); return; }
      if (now - ask > ASK_MS && !leaving) { setLeaving(true); void letGo('start'); }
    }, 1000);
    return () => clearInterval(i);
  }, [step, ask, open, team, leaving, letGo, startOver, texting]);

  /** Into the order (the same item with the same choices is one line); gives back its line's key. */
  const add = (item: Item, picks: Picks, qty: number, offer?: OfferKind, note = '') => {
    const p = priceChoices(item, picks); const each = Math.max(0, item.price + (p.ok ? p.extra : 0)); const text = pickWords(item, picks);
    // (A note of its own makes a line of its own.)
    const k = cart.find((l) => l.itemId === item.id && l.choicesText === text && sameNote(l.note, note))?.key || rid();
    setCart((c) => { const same = c.find((l) => l.itemId === item.id && l.choicesText === text && sameNote(l.note, note)); if (same) return c.map((l) => (l === same ? { ...l, quantity: Math.min(20, l.quantity + qty), ...(offer && !l.offer ? { offer } : {}) } : l)); return [...c, { key: k, itemId: item.id, name: item.name, picks, choicesText: text, quantity: qty, each, ...(offer ? { offer } : {}), ...(note ? { note } : {}) }]; });
    return k;
  };
  // Added from its sheet: then what's offered with it, if there's anything they could have (once an item).
  const added = (item: Item, picks: Picks, qty: number, note = '') => {
    const k = add(item, picks, qty, offered ? 'item' : undefined, note); setOpen(null);
    if (offered) { setOffered(false); return; }
    if (after && !after.took.length) setPassed((p) => [...p, after.itemId]);
    setAfter(null);
    if (passed.includes(item.id)) return;
    const o = offersFor(item, picks, (id) => byId.get(id), (id) => cart.some((l) => l.itemId === id));
    if (o.size || o.items.length) setAfter({ key: k, itemId: item.id, name: item.name, qty, size: o.size, items: o.items, took: [] });
  };
  // The size up: the ones just added, a size bigger (the rest of a line they were added to stays as it was).
  const takeSize = () => {
    const a = after; if (!a?.size || a.took.includes('size')) return;
    const line = cart.find((l) => l.key === a.key); const item = byId.get(a.itemId); if (!line || !item) return;
    const picks = sizedUp(line.picks, a.size); const p = priceChoices(item, picks); if (!p.ok) return;
    const n = Math.max(1, Math.min(a.qty, line.quantity)); const rest = line.quantity - n;
    const twin = cart.find((l) => l.key !== line.key && l.itemId === item.id && l.choicesText === p.text);
    const upKey = twin ? twin.key : rest > 0 ? rid() : line.key;
    const up = { picks, choicesText: p.text, each: Math.max(0, item.price + p.extra), offer: 'size' as const };
    setCart((c) => {
      let next = c.map((l) => (l.key !== line.key ? l : rest > 0 || twin ? { ...l, quantity: rest } : { ...l, ...up }));
      if (twin) next = next.map((l) => (l.key === twin.key ? { ...l, quantity: Math.min(20, l.quantity + n), offer: l.offer || 'size' } : l));
      else if (rest > 0) next = [...next, { ...line, ...up, key: upKey, quantity: n }];
      return next.filter((l) => l.quantity > 0);
    });
    setAfter({ ...a, key: upKey, took: [...a.took, 'size'] });
  };
  // Something to go with it: added as it comes, or, with choices of its own, its sheet opened to pick them.
  const takeItem = (x: Item) => {
    if (!after) return;
    if (x.choices.length) { setAfter(null); setOffered(true); setOpen(x); return; }
    add(x, defaultPicks(x), 1, 'item'); setAfter({ ...after, took: [...after.took, `item:${x.id}`] });
  };
  const closeAfter = () => { if (after && !after.took.length) setPassed((p) => [...p, after.itemId]); setAfter(null); };
  const qty = (k: string, d: number) => { setAfter(null); setCart((c) => c.map((l) => (l.key === k ? { ...l, quantity: Math.max(0, Math.min(20, l.quantity + d)) } : l)).filter((l) => l.quantity > 0)); };

  const toPaid = (n?: string) => { paidAt.current = Date.now(); setPaidName(name.trim().split(' ')[0] || ''); if (n) setPlaced((p) => (p ? { ...p, number: n } : p)); setStep('paid'); };
  const answer = (d: any) => {
    if (d.ok && d.state === 'paid') { toPaid(d.number); return; }
    if (d.ok && d.state === 'let_go') { setPaying({ state: 'trouble', message: t('This order was let go. Please start again.') }); return; }
    // (A card's own reason is the bank's words, in English: in Spanish, what to do instead.)
    if (d.ok) { setPaying({ state: d.state === 'declined' ? 'declined' : d.state === 'starting' || d.state === 'none' ? 'starting' : 'on_reader', message: d.message ? (lang === 'en' ? d.message : t('Try another card, or pay another way.')) : null }); return; }
    setPaying({ state: 'trouble', message: sayIn(lang, d.error, 'The card reader didn’t answer. Try again.') });
  };
  /** Pay: the order is placed (once), then its total goes to this kiosk's reader. */
  const pay = async () => {
    if (menu?.askToGo && toGo === null) { setErr(t('For here or to go?')); return; }
    setBusy(true); setErr('');
    let p = placed;
    if (!p) {
      if (!orderKey.current) orderKey.current = rid();
      const { status, d } = await call({ action: 'place', tenantId, key, orderKey: orderKey.current, name: name.trim(), ...(lang === 'es' ? { lang } : {}), ...(menu?.askToGo ? { toGo: toGo === true } : {}),
        lines: cart.map((l) => ({ itemId: l.itemId, quantity: l.quantity, choices: l.picks, ...(l.offer ? { offer: l.offer } : {}), ...(l.note ? { note: l.note } : {}) })), ...(hasAllergy(allergy) ? { allergy: allergyBody(allergy) } : {}) });
      if (status === 401) { setBusy(false); lost(d); return; }
      if (!d.ok) { setBusy(false); setErr(sayIn(lang, d.error, d.code === 'sold_out' ? 'Something in your order just ran out. Change your order and try again.' : 'That didn’t go through. Try again.')); if (d.code === 'sold_out' || d.code === 'gone' || d.code === 'line') void loadMenu(); if (d.code === 'closed') orderKey.current = ''; return; }
      if (d.paid) { setBusy(false); setPlaced({ orderId: d.orderId, number: d.number, total: 0, lines: [] }); toPaid(d.number); return; }
      p = { orderId: d.orderId, number: d.number, total: d.total, lines: d.lines || [] }; setPlaced(p);
    }
    setStep('pay'); setPaying({ state: 'starting' }); touched.current = Date.now();
    const { d } = await call({ action: 'pay', tenantId, key, orderId: p.orderId });
    setBusy(false); answer(d);
  };
  // While the reader is asking: how it's going, every couple of seconds.
  React.useEffect(() => {
    if (step !== 'pay' || !placed || !paying || paying.state === 'declined' || paying.state === 'trouble') return;
    const i = setInterval(async () => {
      if (checking.current) return; checking.current = true;
      const { d } = await call({ action: 'check', tenantId, key, orderId: placed.orderId }).finally(() => { checking.current = false; });
      if (d.ok || d.error) answer(d);
    }, POLL_MS);
    return () => clearInterval(i);
  }, [step, placed, paying, tenantId, key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <main className="min-h-dvh" style={{ background: SOFT }} />;
  if (!key) return <ScreenSetup kiosk tenantId={tenantId} stopped={stopped} onPaired={(k) => { write(keyName(tenantId), k); setKey(k); setStopped(''); setTeam(true); }} />;
  const A = menu?.accent && HEX.test(menu.accent) ? menu.accent : INK; const tint = tintOf(A); const brand = { background: A, color: '#fff' };
  const items = menu?.sections.find((s) => s.name === section)?.items || [];
  // What's shown big at the top of a section: what the business featured on its menu board (and isn't sold out).
  const hero = items.find((m) => m.featured && !m.soldOut) || null;
  const rest = hero ? items.filter((m) => m !== hero) : items;
  // On the start screen: what's featured or new; else the first things with pictures; else the first on the menu.
  const everything = (menu?.sections || []).flatMap((x) => x.items).filter((m) => !m.soldOut);
  const onToday = [everything.filter((m) => m.featured || m.badge), everything.filter((m) => m.imageUrl), everything].find((xs) => xs.length)?.slice(0, 3) || [];
  const open4 = !!menu && menu.payments && menu.reader && !closed;
  const price = (m: Item) => `${m.from ? `${t('from')} ` : ''}${usd(m.from ? m.startPrice : m.price)}`;
  // The business's names in this guest's language, where it has Spanish; else as written.
  const nm = (m: { name: string; nameEs?: string | null }) => inLang(lang, m.name, m.nameEs); const wd = (m: Item) => inLang(lang, m.words || '', m.wordsEs) || null;
  const lineName = (l: Line) => inLang(lang, l.name, byId.get(l.itemId)?.nameEs);
  const pic = (m: Item, size: number) => m.imageUrl
    ? <img src={m.imageUrl} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size, background: tint }} />
    : <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full font-bold" style={{ width: size, height: size, background: tint, color: A, fontSize: size * 0.38 }}>{nm(m).slice(0, 1)}</span>;
  const offerBox = after && (after.size || after.items.length) ? (() => {
    const line = cart.find((l) => l.key === after.key); const item = byId.get(after.itemId);
    const q = Math.max(1, Math.min(after.qty, line?.quantity || 1)); const bigger = after.size && line && item && !after.took.includes('size') ? priceChoices(item, sizedUp(line.picks, after.size)) : null;
    const took = (k: string) => after.took.includes(k);
    const addedTag = (w: string) => <span className="inline-flex min-h-[48px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-[15px] font-semibold" style={{ background: GREEN_TINT, color: GREEN }}><Check className="h-4 w-4" aria-hidden />{w}</span>;
    return (
      <div role="group" aria-labelledby="kiosk-offer" className="space-y-2 rounded-2xl p-4" style={{ background: tint }}>
        <p id="kiosk-offer" className="text-[16px] font-semibold">{t('Goes well with it')}</p>
        <ul className="space-y-2">
          {after.size && <li className="flex items-center gap-3 rounded-xl bg-[#fff] p-2 pl-3">
            <span className="min-w-0 flex-1 text-[15px]"><b className="font-semibold">{t('Size up to {size}', { size: after.size.to })}</b>{bigger?.ok && <span className="block text-[13.5px]" style={{ color: MUTED }}>{inLang(lang, after.name, item?.nameEs)}, {bigger.text}</span>}</span>
            {took('size') ? addedTag(t('Changed')) : <button type="button" disabled={!bigger?.ok} onClick={takeSize} aria-label={t('Size up to {size}, {price} more', { size: after.size.to, price: usd(after.size.adds * q) })} className={`${btn} min-h-[48px] shrink-0 rounded-full px-4 text-[15px] tabular-nums`} style={brand}>+{usd(after.size.adds * q)}</button>}
          </li>}
          {after.items.map((x) => <li key={x.id} className="flex items-center gap-3 rounded-xl bg-[#fff] p-2 pl-3">
            {x.imageUrl && <img src={x.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" style={{ background: SOFT }} />}
            <span className="min-w-0 flex-1 text-[15px]"><b className="font-semibold">{nm(x)}</b> <span className="tabular-nums" style={{ color: MUTED }}>{price(x)}</span></span>
            {took(`item:${x.id}`) ? addedTag(t('Added')) : <button type="button" onClick={() => takeItem(x)} aria-label={t('Add {name}', { name: nm(x) })} className={`${btn} min-h-[48px] shrink-0 rounded-full px-4 text-[15px]`} style={brand}>{t('Add')}</button>}
          </li>)}
        </ul>
        <button type="button" onClick={closeAfter} className={`${btn} min-h-[48px] bg-[#fff] text-[15px]`} style={{ color: INK }}>{after.took.length ? t('Done') : t('No thanks')}</button>
      </div>);
  })() : null;
  const lineRows = (big: boolean) => <ul>{cart.map((l) => (
    <li key={l.key} className="flex items-center gap-3 py-3" style={{ borderBottom: '1px dashed #cfd2d6' }}>
      <span className="min-w-0 flex-1"><span className={`block font-semibold ${big ? 'text-[17px]' : 'text-[15.5px]'}`}>{lineName(l)}</span>{l.choicesText && <span className="block text-[13.5px]" style={{ color: MUTED }}>{l.choicesText}</span>}
        {l.note && <span className="block text-[13.5px]" style={{ color: MUTED }}>{t('Note: {note}', { note: l.note })}</span>}
        {hasAllergy(allergy) && (() => { const w = conflictWords(dishConflict(byId.get(l.itemId), allergy), allergy, 'guest', lang); return w ? <span className="block text-[14px] font-semibold" style={{ color: AMBER }}>{w}</span> : null; })()}
        <span className="block text-[14px] tabular-nums" style={{ color: MUTED }}>{usd(l.each * l.quantity)}</span></span>
      <span className="flex shrink-0 items-center rounded-full" style={{ border: `1px solid ${LINE}` }} role="group" aria-label={t('How many {name}', { name: lineName(l) })}>
        <button type="button" aria-label={l.quantity === 1 ? t('Take {name} off', { name: lineName(l) }) : t('One fewer {name}', { name: lineName(l) })} onClick={() => qty(l.key, -1)} className={`inline-flex h-12 w-12 items-center justify-center rounded-full ${RING}`}><Minus className="h-4 w-4" /></button>
        <span className="w-6 text-center text-[16px] font-semibold tabular-nums">{l.quantity}</span>
        <button type="button" aria-label={t('One more {name}', { name: lineName(l) })} disabled={l.quantity >= 20} onClick={() => qty(l.key, 1)} className={`inline-flex h-12 w-12 items-center justify-center rounded-full disabled:opacity-30 ${RING}`}><Plus className="h-4 w-4" /></button>
      </span>
    </li>))}</ul>;
  const stillAsk = ask !== null && !leaving && (
    <Modal label={t(step === 'pay' ? 'Still there?' : 'Still ordering?')}>
      <div className="space-y-2 px-6 pt-6"><h2 className="text-[24px] font-semibold tracking-tight">{t(step === 'pay' ? 'Still there?' : 'Still ordering?')}</h2>
        <p className="text-[16px]" style={{ color: MUTED }} aria-live="polite">{t(step === 'pay' ? 'This order will be canceled in {n} seconds.' : 'We’ll start over in {n} seconds.', { n: Math.max(0, Math.ceil((ASK_MS - (Date.now() - ask)) / 1000)) })}</p></div>
      <div className="px-6 py-5"><button type="button" data-start onClick={() => { touched.current = Date.now(); setAsk(null); }} className={`${btn} min-h-[56px] w-full rounded-full text-[17px]`} style={brand}>{t(step === 'pay' ? 'I’m still here' : 'Keep ordering')}</button></div>
    </Modal>);

  if (step === 'start') return (
    <Accent.Provider value={A}>
    <main className="relative grid min-h-dvh md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" style={{ background: '#fff', color: INK }}>
      <section className="flex flex-col justify-center gap-5 p-8 md:p-14" style={{ background: menu ? A : SOFT, color: menu ? '#fff' : INK }}>
        <h1 className="text-[clamp(40px,6.4vw,80px)] font-bold leading-[0.98] tracking-tight">{menu?.business || ' '}</h1>
        {!menu && !loadErr && !closed && <div className="h-8 w-8 animate-spin rounded-full border-[3px]" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label={t('Loading')} />}
        {(loadErr || closed) && <p role="alert" className="max-w-md rounded-2xl bg-[#fff] p-4 text-[17px]" style={{ color: AMBER }}>{sayIn(lang, closed || loadErr, closed ? 'Ordering here is closed for now. Please order at the counter.' : 'The menu couldn’t be loaded. Try again.')}</p>}
        {menu && !closed && (open4 ? <>
          <p className="max-w-md text-[20px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.85)' }}>{t('Order here and pay with your card. We’ll call your number when it’s ready.')}</p>
          <button type="button" onClick={() => { touched.current = Date.now(); setStep('menu'); }} className={`${btnOn} mt-4 min-h-[80px] self-start rounded-full bg-[#fff] px-12 text-[23px]`} style={{ color: A, ...ringOn(A) }}>{t('Start your order')}</button>
          <div role="group" aria-label={t('Language')} className="mt-2 inline-flex self-start rounded-full p-1" style={{ background: 'rgba(255,255,255,0.16)' }}>
            {GUEST_LANGS.map((g) => <button key={g.id} type="button" aria-pressed={lang === g.id} lang={g.id} onClick={() => { touched.current = Date.now(); setLang(g.id); }}
              className={`${btnOn} min-h-[52px] rounded-full px-6 text-[17px]`} style={lang === g.id ? { background: '#fff', color: A, ...ringOn(A) } : { background: 'transparent', color: '#fff', ...ringOn(A) }}>{g.name}</button>)}
          </div>
        </> : <div className="max-w-md rounded-3xl bg-[#fff] p-6 text-left" style={{ color: INK }}>
          <p className="text-[18px] font-semibold">{t('Not taking orders yet')}</p>
          <p className="mt-1.5 text-[15.5px]" style={{ color: MUTED }}>{t('Please order at the counter.')}</p>
          <p className="mt-3 text-[14px]" style={{ color: MUTED }}>{!menu.payments ? 'For the team: card payments aren’t set up for this business yet.' : 'For the team: pick the card reader beside this tablet under Team.'}</p>
        </div>)}
      </section>
      <section aria-labelledby="kiosk-today" className="flex flex-col gap-4 p-8 md:p-12" style={{ background: tint }}>
        {onToday.length > 0 && <>
          <h2 id="kiosk-today" className="text-[26px] font-bold">{t('On today')}</h2>
          <ul className="space-y-3">{onToday.map((m) => (
            <li key={m.id} className="flex items-center gap-4 rounded-[22px] bg-[#fff] p-4">
              {pic(m, 88)}
              <span className="min-w-0 flex-1"><span className="block text-[21px] font-semibold">{nm(m)}</span>{wd(m) && <span className="block truncate text-[15px]" style={{ color: MUTED }}>{wd(m)}</span>}</span>
              <span className="text-[18px] font-semibold tabular-nums">{price(m)}</span>
            </li>))}</ul>
        </>}
        {open4 && <p className="mt-auto text-[15px]" style={{ color: MUTED }}>{t('Pay on the card reader by this screen.')}</p>}
      </section>
      <button type="button" onClick={() => setTeam(true)} className={`absolute bottom-3 right-3 min-h-[44px] rounded-xl px-4 text-[14px] font-medium ${RING}`} style={{ color: MUTED }}>Team</button>
      {team && <ReaderSheet tenantId={tenantId} kioskKey={key} onClose={() => { setTeam(false); void loadMenu(); }} onPicked={() => void loadMenu()} />}
    </main>
    </Accent.Provider>);

  if (step === 'paid') return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6 text-center" style={{ background: tint, color: INK }}>
      <div className="w-full max-w-xl rounded-[36px] bg-[#fff] p-10">
        <p className="inline-flex items-center gap-2 text-[19px] font-semibold" style={{ color: GREEN }} role="status"><Check className="h-6 w-6" aria-hidden />{paidName ? t('Paid. Thank you, {name}', { name: paidName }) : t('Paid. Thank you')}</p>
        <p className="mt-6 text-[18px]" style={{ color: MUTED }}>{t('Your number')}</p>
        <p className="text-[clamp(96px,16vw,168px)] font-bold leading-[0.9] tracking-tight tabular-nums" style={{ color: A }}>{placed?.number || ''}</p>
        <p className="mt-6 text-[18px] leading-relaxed" style={{ color: MUTED }}>{t('We’ll call your number when it’s ready.')}</p>
        {texted ? <p className="mt-3 text-[17px] font-medium" style={{ color: GREEN }} role="status">{texted.sent ? t('It’s ready. We just texted ···{n}.', { n: texted.last4 }) : t('We’ll text ···{n} when it’s ready.', { n: texted.last4 })}</p>
          : menu?.texts && placed?.orderId && key && <button type="button" onClick={() => setTexting(true)} className={`${btn} mt-5 min-h-[60px] w-full rounded-full text-[17px]`} style={quiet}>{t('Text me when it’s ready')}</button>}
        {receiptSent ? <p className="mt-3 text-[17px] font-medium" style={{ color: GREEN }} role="status">{receiptSent}</p>
          : placed?.orderId && key && <button type="button" onClick={() => { touched.current = Date.now(); setReceipting(true); }} className={`${btn} mt-3 min-h-[60px] w-full rounded-full text-[17px]`} style={quiet}>{t('Get a receipt')}</button>}
        <button type="button" onClick={startOver} className={`${btn} mt-3 min-h-[60px] w-full rounded-full text-[17px]`} style={brand}>{t('Done')}</button>
        <p className="mt-3 text-[14px]" style={{ color: MUTED }}>{t('This screen starts over in a few seconds.')}</p>
      </div>
      {texting && placed?.orderId && key && (
        <Accent.Provider value={A}>
          <TextMe tenantId={tenantId} kioskKey={key} orderId={placed.orderId} lang={lang} onClose={() => setTexting(false)}
            onDone={(last4, sent) => { setTexted({ last4, sent }); setTexting(false); paidAt.current = Date.now(); }} />
        </Accent.Provider>)}
      {receipting && placed?.orderId && key && (
        <Accent.Provider value={A}>
          <ReceiptMe tenantId={tenantId} kioskKey={key} orderId={placed.orderId} lang={lang} onClose={() => setReceipting(false)}
            onDone={(words) => { setReceiptSent(words); setReceipting(false); paidAt.current = Date.now(); }} />
        </Accent.Provider>)}
    </main>);

  const receipt = (lines: { name: string; nameEs?: string | null; quantity: number; choicesText: string | null; price: number }[]) => (
    <ul>{lines.map((l, k) => (
      <li key={k} className="py-3" style={{ borderBottom: '1px dashed #cfd2d6' }}>
        <span className="flex justify-between gap-3 text-[18px]"><span className="font-semibold">{l.quantity} {nm(l)}</span><span className="tabular-nums">{usd(l.price)}</span></span>
        {l.choicesText && <span className="block text-[15px]" style={{ color: MUTED }}>{l.choicesText}</span>}
      </li>))}</ul>);

  if (step === 'pay') return (
    <main className="grid min-h-dvh md:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]" style={{ background: '#fff', color: INK }}>
      <section aria-labelledby="kiosk-paying" className="space-y-4 p-8 md:p-12">
        <h1 id="kiosk-paying" className="text-[36px] font-bold tracking-tight">{t('Your order')}</h1>
        {receipt(placed?.lines || [])}
        <p className="flex justify-between pt-1 text-[24px] font-bold"><span>{t('Total')}</span><span className="tabular-nums">{usd(placed?.total || 0)}</span></p>
        {name.trim() && <p className="text-[16px]" style={{ color: MUTED }}>{t('For')} <b className="font-semibold" style={{ color: INK }}>{name.trim().split(' ')[0]}</b>{menu?.askToGo && toGo !== null ? t(toGo ? ', to go' : ', for here') : ''}</p>}
      </section>
      <section className="flex flex-col items-center justify-center gap-5 p-8 text-center md:p-12" style={brand}>
        {paying?.state === 'declined' || paying?.state === 'trouble' ? (
          <div className="w-full max-w-sm space-y-3 rounded-3xl bg-[#fff] p-6 text-left" role="alert">
            <p className="text-[19px] font-semibold" style={{ color: AMBER }}>{t(paying.state === 'declined' ? 'The card didn’t go through' : 'That didn’t go through')}</p>
            {paying.message && <p className="text-[16px]" style={{ color: AMBER }}>{paying.message}</p>}
            <button type="button" disabled={busy} onClick={pay} className={`${btn} min-h-[60px] w-full rounded-full text-[17px]`} style={brand}>{busy ? t('Starting…') : t('Try again')}</button>
          </div>
        ) : <>
          <svg width="150" height="186" viewBox="0 0 170 210" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="35" y="10" width="100" height="150" rx="16" /><rect x="50" y="26" width="70" height="46" rx="6" /><path d="M62 92h46M62 110h46M62 128h30" /><path d="M85 172v26M72 186l13 13 13-13" /></svg>
          <p className="text-[clamp(26px,3vw,36px)] font-bold leading-tight" role="status">{t(paying?.state === 'on_reader' ? 'Tap, insert or swipe your card' : 'Getting the card reader ready…')}</p>
          {paying?.state === 'on_reader' && <p className="text-[18px]" style={{ color: 'rgba(255,255,255,0.85)' }}>{t('on the card reader by this screen')}</p>}
          <p className="text-[48px] font-semibold tabular-nums">{usd(placed?.total || 0)}</p>
          {paying?.state === 'on_reader' && menu?.testReader && placed && <button type="button" disabled={busy} onClick={() => { setErr(''); void call({ action: 'testCard', tenantId, key, orderId: placed.orderId }).then(({ d }) => { if (!d.ok) setErr(d.error || 'The test card didn’t go through. Try again.'); }); }} className={`${btnOn} min-h-[52px] rounded-full px-6 text-[16px]`} style={{ background: '#fff', color: INK, ...ringOn(A) }}>Use a test card (test reader)</button>}
        </>}
        {err && <p role="alert" className="rounded-xl bg-[#fff] px-4 py-2 text-[15px]" style={{ color: AMBER }}>{err}</p>}
        <button type="button" disabled={busy} onClick={() => void letGo('review')} className={`${btnOn} min-h-[56px] rounded-full border-[1.5px] px-8 text-[17px]`} style={{ borderColor: 'rgba(255,255,255,0.55)', color: '#fff', background: 'transparent', ...ringOn(A) }}>{t('Cancel')}</button>
      </section>
      {stillAsk}
    </main>);

  const startOverBtn = (onDark = false) => <button type="button" onClick={startOver} className={`${btn} min-h-[52px] rounded-full text-[16px]`} style={onDark ? { background: '#fff', color: INK, border: '1px solid rgba(22,23,26,0.12)' } : quiet}>{t('Start over')}</button>;

  if (step === 'review') return (
    <Accent.Provider value={A}>
    <main className="min-h-dvh pb-8" style={{ background: '#fff', color: INK }}>
      <header className="flex items-center justify-between gap-4 px-6 pb-3 pt-6 md:px-10">
        <p className="min-w-0 truncate text-[24px] font-bold tracking-tight" style={{ color: A }}>{menu?.business}</p>
        {startOverBtn()}
      </header>
      <div className="mx-auto grid max-w-5xl gap-6 px-6 md:px-10 lg:grid-cols-[1fr_400px]">
        <section aria-labelledby="kiosk-review" className="space-y-2 self-start">
          <h1 id="kiosk-review" className="text-[36px] font-bold tracking-tight">{t('Your order')}</h1>
          {cart.length ? lineRows(true) : <p className="text-[16px]" style={{ color: MUTED }}>{t('Nothing in your order yet.')}</p>}
          <button type="button" onClick={() => setStep('menu')} className={`${btn} mt-2 min-h-[52px] rounded-full text-[16px]`} style={quiet}>{t('Add more')}</button>
        </section>
        <section aria-label={t('Name and pay')} className="space-y-4 self-start rounded-[28px] p-6" style={{ background: tint }}>
          <label className="block"><span className="text-[15px] font-semibold">{t('Your first name')}</span> <span className="text-[14px]" style={{ color: MUTED }}>{t('(optional)')}</span>
            <input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} autoComplete="off" className="mt-1.5 min-h-[56px] w-full rounded-2xl bg-[#fff] px-4 text-[18px] outline-none focus:border-[#16171a]" style={{ border: `1px solid ${LINE}` }} placeholder={t('So we can call it')} /></label>
          <AllergyChips value={allergy} onChange={setAllergy} idBase="kiosk-allergy" big hint={t('Leave it empty if there are none.')} lang={lang} />
          {menu?.askToGo && <div role="radiogroup" aria-label={t('For here or to go')} className="grid grid-cols-2 gap-2">
            {([[false, 'For here'], [true, 'To go']] as [boolean, string][]).map(([v, w]) => <button key={w} type="button" role="radio" aria-checked={toGo === v} onClick={() => { setToGo(v); setErr(''); }} className={`${btn} min-h-[56px] rounded-full text-[17px]`} style={toGo === v ? brand : quiet}>{t(w)}</button>)}
          </div>}
          <dl className="space-y-1 text-[16px]">
            <div className="flex justify-between"><dt style={{ color: MUTED }}>{t('Subtotal')}</dt><dd className="tabular-nums">{usd(subtotal)}</dd></div>
            <div className="flex justify-between"><dt style={{ color: MUTED }}>{t('Tax')}</dt><dd className="tabular-nums">{usd(tax)}</dd></div>
            <div className="flex justify-between text-[22px] font-bold"><dt>{t('Total')}</dt><dd className="tabular-nums">{usd(total)}</dd></div>
          </dl>
          {err && <p role="alert" className="text-[15px]" style={{ color: AMBER }}>{err}</p>}
          <button type="button" disabled={!cart.length || busy} onClick={pay} className={`${btn} min-h-[64px] w-full rounded-full text-[19px] tabular-nums`} style={brand}>{busy ? t('One moment…') : t('Pay {price}', { price: usd(total) })}</button>
          <p className="text-[14px]" style={{ color: MUTED }}>{t('You’ll pay on the card reader. The kitchen starts once it’s paid.')}</p>
        </section>
      </div>
      {stillAsk}
    </main>
    </Accent.Provider>);

  const row = (m: Item) => (
    <li key={m.id} style={{ borderTop: '1px solid #e8eaec' }}>
      <button type="button" disabled={m.soldOut} onClick={() => { setErr(''); setOpen(m); }} aria-label={m.soldOut ? t('{name}, sold out', { name: nm(m) }) : t('{name}, {price}', { name: nm(m), price: price(m) })}
        className={`flex min-h-[88px] w-full items-center gap-4 py-3 text-left disabled:opacity-50 ${RING}`}>
        {pic(m, 64)}
        <span className="min-w-0 flex-1"><span className="block text-[19px] font-semibold leading-snug">{nm(m)}</span>
          <span className="block truncate text-[14.5px]" style={{ color: m.soldOut ? AMBER : m.happy ? GREEN : MUTED }}>{m.soldOut ? t('Sold out') : m.happy ? t('Happy hour price') : wd(m) || ''}</span></span>
        <span className="shrink-0 text-[17px] font-semibold tabular-nums">{m.soldOut ? '' : price(m)}</span>
      </button>
    </li>);
  const sectionBtn = (x: { name: string; nameEs?: string | null }, vertical: boolean) => {
    const on = x.name === section;
    return <button key={x.name} type="button" role="tab" aria-selected={on} onClick={() => setSection(x.name)}
      className={`${btn} min-h-[56px] shrink-0 text-[19px] font-semibold ${vertical ? 'w-full !justify-start rounded-2xl px-4' : 'rounded-full'}`}
      style={on ? brand : vertical ? { background: 'transparent', color: INK } : quiet}>{nm(x)}</button>;
  };

  return (
    <Accent.Provider value={A}>
    <main className="min-h-dvh pb-28 lg:grid lg:grid-cols-[210px_minmax(0,1fr)_360px] lg:pb-0" style={{ background: '#fff', color: INK }}>
      <nav aria-label={t('Menu')} className="hidden flex-col gap-1.5 px-4 py-7 lg:flex lg:min-h-dvh" style={{ background: tint }}>
        <h1 className="mb-5 px-1 text-[26px] font-bold leading-[1.05] tracking-tight" style={{ color: A }}>{menu?.business}</h1>
        <div role="tablist" aria-label={t('Menu sections')} aria-orientation="vertical" className="flex flex-col gap-1.5">{(menu?.sections || []).map((x) => sectionBtn(x, true))}</div>
        <div className="mt-auto pt-4">{startOverBtn(true)}</div>
      </nav>
      <header className="flex items-center justify-between gap-4 px-6 pb-2 pt-5 lg:hidden">
        <h1 className="min-w-0 truncate text-[22px] font-bold tracking-tight" style={{ color: A }}>{menu?.business}</h1>
        {startOverBtn()}
      </header>
      <section aria-label={nm(menu?.sections.find((x) => x.name === section) || { name: section || t('Menu') })} className="min-w-0 px-6 lg:px-7 lg:py-7">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-3 lg:hidden" role="tablist" aria-label={t('Menu sections')}>{(menu?.sections || []).map((x) => sectionBtn(x, false))}</div>
        {hero && <div className="mb-4 grid items-center gap-5 rounded-[24px] p-4 sm:grid-cols-[minmax(0,240px)_1fr]" style={{ background: tint }}>
          {hero.imageUrl ? <img src={hero.imageUrl} alt="" className="aspect-[4/3] w-full rounded-[18px] object-cover" style={{ background: '#fff' }} /> : <span aria-hidden className="flex aspect-[4/3] w-full items-center justify-center rounded-[18px] bg-[#fff] text-[64px] font-bold" style={{ color: A }}>{nm(hero).slice(0, 1)}</span>}
          <div className="space-y-2">
            {hero.badge && <p className="text-[14px] font-semibold" style={{ color: INK }}>{t(hero.badge === 'new' ? 'New' : 'Limited time')}</p>}
            <h2 className="text-[clamp(28px,3.2vw,40px)] font-bold leading-none tracking-tight">{nm(hero)}</h2>
            {wd(hero) && <p className="text-[16px] leading-relaxed" style={{ color: MUTED }}>{wd(hero)}</p>}
            <div className="flex items-center gap-4 pt-1">
              <span className="text-[20px] font-semibold tabular-nums">{price(hero)}</span>
              <button type="button" onClick={() => { setErr(''); setOpen(hero); }} className={`${btn} min-h-[52px] rounded-full px-7 text-[16px]`} style={brand} aria-label={t('Add {name}', { name: nm(hero) })}>{t('Add')}</button>
            </div>
          </div>
        </div>}
        <ul className="grid gap-x-6 xl:grid-cols-2">{rest.map(row)}</ul>
      </section>
      <aside aria-labelledby="kiosk-order" className="hidden flex-col gap-3 border-l px-5 py-7 lg:flex lg:min-h-dvh" style={{ borderColor: '#e8eaec' }}>
        <h2 id="kiosk-order" className="text-[24px] font-bold">{t('Your order')}</h2>
        {offerBox}
        {cart.length ? lineRows(false) : <p className="text-[15.5px]" style={{ color: MUTED }}>{t('Tap something to add it.')}</p>}
        <p className="mt-auto flex justify-between pt-3 text-[17px]"><span style={{ color: MUTED }}>{t(count === 1 ? '{n} item' : '{n} items', { n: count })}</span><span className="font-semibold tabular-nums">{usd(subtotal)}</span></p>
        <button type="button" disabled={!cart.length} onClick={() => { setAfter(null); setStep('review'); }} className={`${btn} min-h-[62px] w-full rounded-full text-[18px]`} style={brand}>{t('Review and pay')}</button>
      </aside>
      <div className="fixed inset-x-0 bottom-0 space-y-3 border-t bg-[#fff] px-6 py-4 lg:hidden" style={{ borderColor: LINE }}>
        {offerBox}
        <div className="flex items-center justify-between gap-4">
          <p className="text-[17px] tabular-nums" aria-live="polite">{count ? t(count === 1 ? '{n} item, {price}' : '{n} items, {price}', { n: count, price: usd(subtotal) }) : t('Tap something to add it.')}</p>
          <button type="button" disabled={!cart.length} onClick={() => { setAfter(null); setStep('review'); }} className={`${btn} min-h-[60px] rounded-full text-[18px]`} style={brand}>{t('Review and pay')}</button>
        </div>
      </div>
      {open && <ItemSheet item={open} lang={lang} onClose={() => { setOpen(null); setOffered(false); }} onAdd={(p, n, note) => added(open, p, n, note)} />}
      {stillAsk}
    </main>
    </Accent.Provider>
  );
}
