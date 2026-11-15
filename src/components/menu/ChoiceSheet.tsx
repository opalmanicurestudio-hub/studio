'use client';
// src/components/menu/ChoiceSheet.tsx — AN ITEM'S CHOICES BEFORE IT'S ADDED, for the team (design canvas "Choices
// everywhere"): a table's tab and the front desk. The guests' own picker (ChoicePicker) in a sheet, priced from the
// menu as choices are made (lib/menu-choices priceChoices, the same rules the server checks); a choice that must be made
// is asked for before Add does anything. A size starts on the first one still available.
import * as React from 'react';
import { ChoicePicker } from '@/components/menu/ChoicePicker';
import { defaultPicks, priceChoices, type PickedChoice, type Picks } from '@/lib/menu-choices';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', AMBER = '#b45309';
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

export type Chosen = { picks: Picks; lines: PickedChoice[]; text: string; extra: number };

export function ChoiceSheet({ item, price, line, busy, onClose, onAdd }: {
  item: any; price: number; line?: string; busy?: boolean; onClose: () => void; onAdd: (c: Chosen) => void;
}) {
  const start = React.useMemo(() => defaultPicks(item), [item]);
  const [picks, setPicks] = React.useState<Picks>(start);
  const [tried, setTried] = React.useState(false);
  const r = priceChoices(item, picks);
  const each = Math.round(((Number(price) || 0) + (r.ok ? r.extra : 0)) * 100) / 100;
  const box = React.useRef<HTMLDivElement | null>(null); const title = React.useRef<HTMLHeadingElement | null>(null);
  const closeRef = React.useRef(onClose); closeRef.current = onClose;
  // Focus goes to the sheet and comes back to what was tapped; the page behind doesn't scroll; Tab stays inside.
  React.useEffect(() => {
    const back = document.activeElement as HTMLElement | null; title.current?.focus();
    const was = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const f = Array.from(box.current.querySelectorAll<HTMLElement>('button, input:not([disabled]), [tabindex="0"]')).filter((x) => !x.hasAttribute('disabled'));
      if (!f.length) return; const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === title.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = was; try { back?.focus?.(); } catch { /* */ } };
  }, []);
  // A tap outside closes it only while nothing's been changed: choices made aren't lost to a stray tap.
  const changed = JSON.stringify(picks) !== JSON.stringify(start);
  const add = () => { if (!r.ok) { setTried(true); return; } onAdd({ picks, lines: r.lines, text: r.text, extra: r.extra }); };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} role="dialog" aria-modal="true" aria-labelledby="choose-title"
      onClick={(e) => { if (e.target === e.currentTarget && !changed) onClose(); }}>
      <div ref={box} className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-3xl bg-[#fff] sm:rounded-3xl" style={{ color: INK }}>
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div className="min-w-0">
            <h2 id="choose-title" ref={title} tabIndex={-1} className="text-[20px] font-semibold leading-tight outline-none">{String(item?.name || 'Item')}</h2>
            {line && <p className="text-[14px]" style={{ color: MUTED }}>{line}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[20px]" style={{ background: SOFT, color: INK }}>×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2"><ChoicePicker item={item} picks={picks} onChange={(p) => { setTried(false); setPicks(p); }} /></div>
        <div className="space-y-2 p-5 pt-3" style={{ borderTop: `1px solid ${LINE}` }}>
          {!r.ok && tried && <p role="alert" className="text-[14px] font-semibold" style={{ color: AMBER }}>{r.error}</p>}
          <button type="button" disabled={busy} onClick={add} className="min-h-[52px] w-full rounded-2xl text-[16px] font-semibold disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2"
            style={r.ok ? { background: INK, color: '#fff' } : { background: LINE, color: MUTED }}>Add, {money(each)}</button>
          <p className="sr-only" aria-live="polite">{`${String(item?.name || 'It')} comes to ${money(each)}`}</p>
        </div>
      </div>
    </div>
  );
}
