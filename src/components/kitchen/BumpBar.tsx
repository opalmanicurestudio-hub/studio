'use client';
// src/components/kitchen/BumpBar.tsx — THE BUMP BAR's parts on the kitchen screen (lib/bump-bar; design board "A bump bar
// at each station", A): the number in each card's corner, the strip along the bottom that says what each key does, and
// "Set up a bump bar", which learns a bar's own keys one press at a time and keeps them on the tablet.
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/components/kitchen/ScreenLang';
import { ACTION_WORDS, LEARN_ORDER, isModifierOnly, keySig, keyWords, learn, type BumpAction, type LearnedKeys } from '@/lib/bump-bar';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GREEN = '#1f7a4d';

/** The number a card is picked by. */
export function BumpNo({ n, on }: { n: number | null; on: boolean }) {
  if (n === null) return null;
  return <span aria-hidden className="inline-flex h-8 min-w-[32px] shrink-0 items-center justify-center rounded-lg px-1.5 text-[16px] font-semibold tabular-nums" style={on ? { background: INK, color: '#fff' } : { background: SOFT, color: INK }}>{n}</span>;
}

/** The usual key for each action, as the strip and the setup show it. */
const USUAL: Record<BumpAction, string> = { bump: 'Enter', recall: 'Backspace', next: 'Down arrow', prev: 'Up arrow', pick1: '1', pick2: '2', pick3: '3', pick4: '4', pick5: '5', pick6: '6', pick7: '7', pick8: '8', pick9: '9' };
const keyOf = (keys: LearnedKeys, a: BumpAction) => (keys[a] ? keyWords(keys[a]!) : USUAL[a]);

function Key({ children, tone }: { children: React.ReactNode; tone?: 'go' | 'dark' }) {
  return <b className="inline-flex h-8 min-w-[32px] items-center justify-center rounded-lg px-2 text-[13px] font-semibold" style={tone === 'go' ? { background: GREEN, color: '#fff' } : tone === 'dark' ? { background: INK, color: '#fff' } : { background: SOFT, color: INK, border: `1px solid ${LINE}` }}>{children}</b>;
}

/** Along the bottom: what each key does right now, for the card picked. */
export function KeyStrip({ keys, picked, bumpWords, recallWords, onSetUp, onHide }: {
  keys: LearnedKeys; picked: string | null; bumpWords: string | null; recallWords: string | null; onSetUp: () => void; onHide: () => void;
}) {
  const say = useT();
  const keyFor = (k: LearnedKeys, a: BumpAction) => say(keyOf(k, a));
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 bg-[#fff] px-4 sm:px-6 py-2" style={{ borderTop: `1px solid ${LINE}`, boxShadow: '0 -6px 18px rgba(22,23,26,0.06)' }} role="region" aria-label={say('Bump bar keys')}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px]" style={{ color: INK }}>
        <span className="font-semibold" aria-live="polite">{picked ? say('Picked: {what}', { what: picked }) : say('Nothing picked')}</span>
        <span className="inline-flex items-center gap-1.5"><Key>{keyFor(keys, 'pick1')}</Key>{say('to')}<Key>{keyFor(keys, 'pick9')}</Key><span style={{ color: MUTED }}>{say('pick')}</span></span>
        <span className="inline-flex items-center gap-1.5"><Key tone="go">{keyFor(keys, 'bump')}</Key><span style={{ color: MUTED }}>{bumpWords || say('bump')}</span></span>
        <span className="inline-flex items-center gap-1.5"><Key>2</Key><Key>2</Key><span style={{ color: MUTED }}>{say('twice quickly bumps it')}</span></span>
        <span className="inline-flex items-center gap-1.5"><Key>{keyFor(keys, 'prev')}</Key><Key>{keyFor(keys, 'next')}</Key><span style={{ color: MUTED }}>{say('move')}</span></span>
        <span className="inline-flex items-center gap-1.5"><Key>{keyFor(keys, 'recall')}</Key><span style={{ color: MUTED }}>{recallWords || say('nothing to bring back')}</span></span>
        <span className="ml-auto flex gap-1">
          <button type="button" onClick={onSetUp} className="min-h-[44px] rounded-xl px-3 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a]" style={{ color: INK }}>{say('Set up a bump bar')}</button>
          <button type="button" onClick={onHide} className="min-h-[44px] rounded-xl px-3 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a]" style={{ color: MUTED }}>{say('Hide')}</button>
        </span>
      </div>
    </div>
  );
}

/** "Set up a bump bar": press each of the bar's keys when asked (or skip to keep the usual one). Kept on this tablet. */
export function BumpBarSheet({ keys, strip, onSave, onStrip, onClose }: {
  keys: LearnedKeys; strip: boolean; onSave: (k: LearnedKeys) => void; onStrip: (on: boolean) => void; onClose: () => void;
}) {
  const say = useT();
  const [draft, setDraft] = useState<LearnedKeys>(keys);
  // Which key it's waiting for (an index into LEARN_ORDER), or -1 when it isn't listening.
  const [at, setAt] = useState(-1);
  const [heard, setHeard] = useState('');
  const box = useRef<HTMLDivElement | null>(null); const close = useRef(onClose); close.current = onClose;
  const atRef = useRef(at); atRef.current = at;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('button')?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (atRef.current >= 0) setAt(-1); else close.current(); return; }
      if (atRef.current < 0 || e.key === 'Tab' || isModifierOnly(e) || e.repeat) return;
      const sig = keySig(e); if (!sig) return;
      e.preventDefault(); e.stopPropagation();
      const a = LEARN_ORDER[atRef.current];
      setDraft((d) => learn(d, a, sig)); setHeard(say('{action}: {key}', { action: say(ACTION_WORDS[a]), key: keyWords(sig) }));
      setAt((i) => (i + 1 < LEARN_ORDER.length ? i + 1 : -1));
    };
    document.addEventListener('keydown', k, true);
    return () => { document.removeEventListener('keydown', k, true); opener?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = at >= 0 ? LEARN_ORDER[at] : null;
  const skip = () => setAt((i) => (i + 1 < LEARN_ORDER.length ? i + 1 : -1));
  const btn = 'min-h-[48px] rounded-xl px-4 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(22,23,26,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="bump-title" className="w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#fff] p-5 sm:p-6 space-y-4" style={{ color: INK }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="bump-title" className="text-[20px] font-semibold">{say('Set up a bump bar')}</h2>
            <p className="mt-1 text-[14px] leading-relaxed" style={{ color: MUTED }}>{say('Plug the bump bar into this tablet. The usual keys already work: numbers pick, Enter bumps, Backspace brings back, the arrows move. If your bar’s keys are different, teach it here: press each one when asked. Kept on this tablet only.')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={say('Close')} className="h-11 w-11 shrink-0 rounded-full border text-[20px]" style={{ borderColor: LINE }}>×</button>
        </div>

        {waiting
          ? <div className="rounded-2xl p-4 space-y-3" style={{ background: SOFT }} role="status" aria-live="polite">
              <p className="text-[13px] font-semibold" style={{ color: MUTED }}>{say('Key {n} of {of}', { n: at + 1, of: LEARN_ORDER.length })}</p>
              <p className="text-[22px] font-semibold leading-snug">{say('Press the key for {action}', { action: say(ACTION_WORDS[waiting]) })}</p>
              {heard && <p className="text-[14px] font-medium" style={{ color: GREEN }}>{say('Got it. {what}', { what: heard })}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={skip} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>{say('Skip, keep {key}', { key: say(USUAL[waiting]) })}</button>
                <button type="button" onClick={() => setAt(-1)} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>{say('Stop here')}</button>
              </div>
            </div>
          : <button type="button" onClick={() => { setHeard(''); setAt(0); }} className={`${btn} w-full`} style={{ background: INK, color: '#fff' }}>{Object.keys(draft).length ? say('Teach it again') : say('Teach it my bar’s keys')}</button>}

        <div>
          <p className="text-[14px] font-semibold">{say('What each key does')}</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-4">
            {LEARN_ORDER.map((a) => (
              <li key={a} className="flex min-h-[40px] items-center justify-between gap-2 text-[14px]" style={{ borderBottom: `1px solid ${LINE}` }}>
                <span>{say(ACTION_WORDS[a])}</span>
                <span className="font-semibold" style={{ color: draft[a] ? INK : MUTED }}>{say(keyOf(draft, a))}</span>
              </li>))}
          </ul>
        </div>

        <button type="button" role="switch" aria-checked={strip} onClick={() => onStrip(!strip)} className="flex w-full min-h-[48px] items-center justify-between gap-3 rounded-xl text-left text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16171a]">
          <span>{say('Show the keys along the bottom')}</span>
          <span aria-hidden className="relative h-8 w-14 shrink-0 rounded-full" style={{ background: strip ? GREEN : '#d4d6da' }}><span className="absolute top-1 h-6 w-6 rounded-full bg-[#fff] shadow" style={{ left: strip ? 28 : 4 }} /></span>
        </button>

        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={() => { onSave(draft); onClose(); }} className={`${btn} flex-1`} style={{ background: INK, color: '#fff' }}>{say('Save')}</button>
          {Object.keys(draft).length > 0 && <button type="button" onClick={() => { setDraft({}); setAt(-1); setHeard(''); }} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}`, color: INK }}>{say('Use the usual keys')}</button>}
        </div>
      </div>
    </div>
  );
}
