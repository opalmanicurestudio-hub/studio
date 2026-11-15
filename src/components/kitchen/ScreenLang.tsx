'use client';
// src/components/kitchen/ScreenLang.tsx — ENGLISH OR ESPAÑOL on the kitchen, dish and barback screens (lib/screen-lang).
// Picked on the screen and kept on the device, so a tablet set to Spanish stays that way through every shift. The
// screen's parts read it with useT(); anything outside a screen reads English.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { LANG_KEY, LANGS, cleanLang, tr, type Lang } from '@/lib/screen-lang';

const INK = '#16171a', MUTED = '#6d7075', SOFT = '#f5f5f7';
const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'en', setLang: () => undefined });

export function ScreenLangProvider({ children }: { children: React.ReactNode }) {
  const [lang, set] = useState<Lang>('en');
  useEffect(() => { try { set(cleanLang(localStorage.getItem(LANG_KEY))); } catch { /* private window: English */ } }, []);
  const setLang = useCallback((l: Lang) => { set(l); try { if (l === 'en') localStorage.removeItem(LANG_KEY); else localStorage.setItem(LANG_KEY, l); } catch { /* kept for this visit only */ } }, []);
  return <Ctx.Provider value={{ lang, setLang }}><div lang={lang} className="contents">{children}</div></Ctx.Provider>;
}
export const useLang = () => useContext(Ctx);
/** The screen's words in its language: t('Ready'), t('{n} tickets up', { n: 4 }). */
export function useT() {
  const { lang } = useContext(Ctx);
  return useCallback((en: string, vars?: Record<string, string | number>) => tr(lang, en, vars), [lang]);
}

/** English | Español, side by side, on the screen's header. */
export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className="inline-flex rounded-xl p-1" style={{ background: SOFT }} role="group" aria-label={tr(lang, 'Language')}>
      {LANGS.map((l) => (
        <button key={l.id} type="button" lang={l.id} aria-pressed={lang === l.id} onClick={() => setLang(l.id)} className="min-h-[44px] rounded-lg px-3 text-[14px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#16171a]"
          style={lang === l.id ? { background: '#fff', color: INK, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' } : { color: MUTED }}>{l.name}</button>
      ))}
    </div>
  );
}
