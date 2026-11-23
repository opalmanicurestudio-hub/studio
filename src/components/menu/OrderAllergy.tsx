'use client';
// src/components/menu/OrderAllergy.tsx — ALLERGIES AND NOTES, THE PARTS EVERY ORDERING SCREEN SHARES (lib/order-allergy;
// design board "Allergies and notes on every food order"). The counter, the drive-thru, the kiosk and ordering ahead:
// - AllergyChips: the major allergens to tap, another in their own words, and whether it's severe.
// - AllergySheet: the same, over the counter or drive-thru screen, saved on the order being taken.
// - NoteField and LineNote: a note for the kitchen about one dish ("no onions").
// AllergyChips and NoteField take a guest screen's language (lib/guest-lang): the kiosk set to Español.
import { allergenIn, gt, type GuestLang } from '@/lib/guest-lang';
import { useEffect, useRef, useState } from 'react';
import { ALLERGENS, type AllergenKey } from '@/lib/allergens';
import { NOTE_MAX, OTHER_MAX } from '@/lib/order-allergy';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
const btn = `min-h-[44px] rounded-xl px-4 text-[14.5px] font-semibold disabled:opacity-40 ${RING}`;

export type AllergyValue = { keys: AllergenKey[]; other: string; severe: boolean };
export const NO_ALLERGY: AllergyValue = { keys: [], other: '', severe: false };
/** From what's kept on an order (or nothing). */
export const allergyFrom = (a: { keys?: AllergenKey[]; other?: string | null; severe?: boolean } | null | undefined): AllergyValue => (a ? { keys: a.keys || [], other: a.other || '', severe: !!a.severe } : NO_ALLERGY);
/** Anything picked or typed. */
export const hasAllergy = (v: AllergyValue) => v.keys.length > 0 || !!v.other.trim();
/** What goes to the server: the value, or null for none. */
export const allergyBody = (v: AllergyValue) => (hasAllergy(v) ? { keys: v.keys, other: v.other.trim(), severe: v.severe } : null);

/** The major allergens to tap, another in their words, and severe. `big`: the kiosk's and the phone's larger taps. */
export function AllergyChips({ value, onChange, idBase, title = 'Any allergies?', hint, big = false, lang = 'en' }: { value: AllergyValue; onChange: (v: AllergyValue) => void; idBase: string; title?: string; hint?: string; big?: boolean; lang?: GuestLang }) {
  const toggle = (k: AllergenKey) => onChange({ ...value, keys: value.keys.includes(k) ? value.keys.filter((x) => x !== k) : ALLERGENS.map((a) => a.key).filter((x) => x === k || value.keys.includes(x)) });
  const any = hasAllergy(value);
  return (
    <fieldset className="space-y-2.5">
      <legend className={big ? 'text-[17px] font-semibold' : 'text-[15px] font-semibold'}>{gt(lang, title)}</legend>
      {hint && <p className="text-[13.5px]" style={{ color: MUTED }}>{hint}</p>}
      <div className="flex flex-wrap gap-1.5">{ALLERGENS.map((a) => { const on = value.keys.includes(a.key); return (
        <button key={a.key} type="button" aria-pressed={on} onClick={() => toggle(a.key)} className={`${big ? 'min-h-[48px] px-4 text-[15.5px]' : 'min-h-[44px] px-3.5 text-[14px]'} rounded-full font-semibold ${RING}`}
          style={on ? { background: INK, color: '#fff', border: `1px solid ${INK}` } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}>{allergenIn(lang, a.key, a.label)}</button>); })}</div>
      <label className="block text-[13.5px] font-semibold" htmlFor={`${idBase}-other`}>{gt(lang, 'Another allergy')}</label>
      <input id={`${idBase}-other`} value={value.other} onChange={(e) => onChange({ ...value, other: e.target.value.slice(0, Math.max(OTHER_MAX, value.other.length)) })} maxLength={Math.max(OTHER_MAX, value.other.length)} autoComplete="off" placeholder={gt(lang, 'Like mustard')}
        className={`block ${big ? 'min-h-[52px] text-[17px]' : 'min-h-[44px] text-[16px]'} w-full rounded-xl px-3 font-normal ${RING}`} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK }} />
      <label className={`flex min-h-[44px] items-center gap-3 ${big ? 'text-[16px]' : 'text-[15px]'}`} style={{ color: any ? INK : MUTED }}>
        <input type="checkbox" checked={value.severe} disabled={!any} onChange={(e) => onChange({ ...value, severe: e.target.checked })} className="h-5 w-5 accent-[#16171a]" />{gt(lang, 'It’s severe')}
      </label>
    </fieldset>);
}

/** The order's allergies, over the counter or drive-thru screen: saved on the order being taken (api/counter 'allergy'). */
export function AllergySheet({ start, busy, onSave, onClose, name, sent = false }: { start: AllergyValue; busy: boolean; onSave: (v: AllergyValue) => void; onClose: () => void; name?: string; sent?: boolean }) {
  const [v, setV] = useState<AllergyValue>(start);
  const box = useRef<HTMLDivElement>(null);
  // (The screen behind keeps reading every few seconds: focus is set once, when the sheet opens, never again.)
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const was = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('button, input')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const f = Array.from(box.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); was?.focus?.(); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="allergy-sheet-title" className="max-h-[92vh] w-full max-w-[520px] space-y-4 overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl" style={{ background: '#fff', color: INK }}>
        <div>
          <h2 id="allergy-sheet-title" className="text-[18px] font-semibold">Allergies{name ? ` for ${name}` : ''}</h2>
          <p className="mt-1 text-[13.5px]" style={{ color: MUTED }}>{sent ? 'It’s with the kitchen: added to what’s still being made, and the kitchen taps Allergy noted again. Tell them too.' : 'On every kitchen ticket for this order. The kitchen taps Allergy noted before it’s ready.'}</p>
        </div>
        <AllergyChips value={v} onChange={setV} idBase="allergy-sheet" title="What are they allergic to?" />
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || (sent && !hasAllergy(v))} onClick={() => onSave(v)} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>{hasAllergy(v) || sent ? 'Save the allergies' : 'No allergies'}</button>
          <button type="button" onClick={onClose} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>Close</button>
        </div>
      </div>
    </div>);
}

/** A note for the kitchen about one dish, as it's added (the kiosk's and the phone's choice sheet). */
export function NoteField({ value, onChange, id, big = false, lang = 'en' }: { value: string; onChange: (v: string) => void; id: string; big?: boolean; lang?: GuestLang }) {
  return (
    <label className={`block ${big ? 'text-[16px]' : 'text-[14px]'} font-semibold`} htmlFor={id}>{gt(lang, 'A note for the kitchen')}
      <input id={id} value={value} onChange={(e) => onChange(e.target.value.slice(0, NOTE_MAX))} maxLength={NOTE_MAX} autoComplete="off" placeholder={gt(lang, 'Like no onions')}
        className={`mt-1.5 block ${big ? 'min-h-[52px] text-[17px]' : 'min-h-[44px] text-[16px]'} w-full rounded-xl px-3 font-normal ${RING}`} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK }} />
    </label>);
}

/** A line's note on the counter or the drive-thru: shown, or Add a note; changed in place while the order is taken. */
export function LineNote({ note, name, busy, editable, onSave }: { note: string | null | undefined; name: string; busy: boolean; editable: boolean; onSave: (note: string) => void }) {
  const [open, setOpen] = useState(false); const [v, setV] = useState(note || '');
  useEffect(() => { if (!open) setV(note || ''); }, [note, open]);
  if (!editable) return note ? <span className="block text-[13px]" style={{ color: MUTED }}>Note: {note}</span> : null;
  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} disabled={busy} className={`flex min-h-[44px] items-center text-left text-[13px] font-medium underline underline-offset-4 ${RING}`} style={{ color: note ? INK : MUTED }}
      aria-label={note ? `Change the note on ${name}` : `Add a note to ${name}`}>{note ? `Note: ${note}` : 'Add a note'}</button>);
  return (
    <span className="flex items-center gap-1.5 py-1">
      <input value={v} onChange={(e) => setV(e.target.value.slice(0, NOTE_MAX))} maxLength={NOTE_MAX} autoFocus aria-label={`A note for the kitchen about ${name}`} placeholder="Like no onions"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSave(v); setOpen(false); } if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } }}
        className={`min-h-[44px] min-w-0 flex-1 rounded-xl px-3 text-[15px] ${RING}`} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK }} />
      <button type="button" disabled={busy} onClick={() => { onSave(v); setOpen(false); }} className={`${btn} px-3 text-[14px]`} style={{ background: INK, color: '#fff' }}>Save</button>
    </span>);
}
