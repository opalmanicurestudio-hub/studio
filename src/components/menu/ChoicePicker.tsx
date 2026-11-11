'use client';
// src/components/menu/ChoicePicker.tsx — PICKING AN ITEM'S CHOICES (size, milk, extras) wherever someone orders: the
// station tablet, the guest's own phone, and later the counter, kiosk and drive-thru. Real radio buttons for "pick one"
// and checkboxes for "pick any", each with what it adds or takes off; a sold-out option is shown, can't be picked, and
// says so. The price on the button is worked out by the caller from priceChoices() with the same picks the server checks.
import { useId } from 'react';
import { choiceGroups, money, type Picks } from '@/lib/menu-choices';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee';

export function ChoicePicker({ item, picks, onChange, accent = INK }: { item: any; picks: Picks; onChange: (p: Picks) => void; accent?: string }) {
  const uid = useId();
  const groups = choiceGroups(item);
  if (!groups.length) return null;
  const set = (gid: string, ids: string[]) => onChange({ ...picks, [gid]: ids });
  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const on = picks[g.id] || [];
        const full = g.pick === 'any' && on.length >= g.max;
        return (
          <fieldset key={g.id} className="space-y-2">
            <legend className="mb-2 text-[16px] font-semibold" style={{ color: INK }}>
              {g.name}<span className="ml-1.5 text-[14px] font-normal" style={{ color: MUTED }}>{g.pick === 'one' ? (g.required ? 'pick one' : 'pick one, if you like') : g.max < g.options.length ? `pick up to ${g.max}` : 'pick any'}</span>
            </legend>
            {g.options.map((o) => {
              const checked = on.includes(o.id);
              // A sold-out option they already had stays tappable so it can be taken off; a full "pick any" takes no more.
              const disabled = (o.soldOut && !checked) || (!checked && full);
              const id = `${uid}-${g.id}-${o.id}`;
              return (
                <label key={o.id} htmlFor={id} className={`flex min-h-[48px] items-center gap-3 rounded-2xl border px-4 py-2.5 ${disabled ? '' : 'cursor-pointer'} focus-within:ring-2 focus-within:ring-[#16171a] focus-within:ring-offset-2`}
                  style={{ borderColor: checked ? accent : LINE, borderWidth: checked ? 2 : 1, background: o.soldOut ? '#f5f5f7' : '#fff' }}>
                  <input id={id} type={g.pick === 'one' ? 'radio' : 'checkbox'} name={`${uid}-${g.id}`} checked={checked} disabled={disabled} className="sr-only"
                    onChange={() => set(g.id, g.pick === 'one' ? (checked && !g.required ? [] : [o.id]) : checked ? on.filter((x) => x !== o.id) : [...on, o.id])}
                    onClick={() => { if (g.pick === 'one' && checked && !g.required) set(g.id, []); }} />
                  <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center border-2 ${g.pick === 'one' ? 'rounded-full' : 'rounded-[5px]'}`} style={{ borderColor: checked ? accent : '#b9bbc0', background: checked && g.pick === 'any' ? accent : '#fff' }}>
                    {checked && (g.pick === 'one' ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} /> : <span className="h-2 w-2 rounded-[2px]" style={{ background: '#fff' }} />)}
                  </span>
                  <span className="min-w-0 flex-1 text-[15.5px]" style={{ color: o.soldOut ? MUTED : INK, textDecoration: o.soldOut ? 'line-through' : undefined }}>{o.name}</span>
                  {o.soldOut && <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-semibold" style={{ background: '#fff7ed', color: '#b45309' }}>Sold out</span>}
                  {o.price !== 0 && !o.soldOut && <span className="shrink-0 text-[14.5px] tabular-nums" style={{ color: MUTED }}>{o.price > 0 ? '+' : ''}{money(o.price)}</span>}
                </label>
              );
            })}
          </fieldset>
        );
      })}
    </div>
  );
}
