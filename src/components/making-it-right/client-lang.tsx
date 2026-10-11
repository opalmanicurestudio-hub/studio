'use client';
// src/components/making-it-right/client-lang.tsx — CLIENT PAGES IN THE CLIENT'S LANGUAGE. The page's words are written in
// English; t('…') swaps in the client's language. Which language: the one they pick on the page (remembered on this
// phone), else the one on their client record, else their phone's. Translations come from the page's own server route
// (one batched call, cached per business, so the same words are only ever translated once). {name}-style blanks are
// filled after translating. Until a translation arrives the English shows.
import * as React from 'react';

export const CLIENT_LANGS: { code: string; native: string }[] = [
  { code: 'en', native: 'English' }, { code: 'es', native: 'Español' }, { code: 'vi', native: 'Tiếng Việt' }, { code: 'ko', native: '한국어' },
  { code: 'zh', native: '中文' }, { code: 'pt', native: 'Português' }, { code: 'fr', native: 'Français' }, { code: 'ht', native: 'Kreyòl ayisyen' },
  { code: 'ar', native: 'العربية' }, { code: 'ru', native: 'Русский' },
];
const KNOWN = new Set(CLIENT_LANGS.map((l) => l.code));
const STORE = 'cf-client-lang';
const pick = (x: any) => { const c = String(x || '').slice(0, 2).toLowerCase(); return KNOWN.has(c) ? c : null; };

export type T = (s: string | null | undefined, vars?: Record<string, string | number | null | undefined>) => string;

export function useClientLang(fetchStrings: (lang: string, texts: string[]) => Promise<string[] | null>, recordLang?: string | null) {
  const [lang, setLangState] = React.useState('en'); const [chosen, setChosen] = React.useState(false);
  React.useEffect(() => {
    let saved: string | null = null; try { saved = pick(window.localStorage.getItem(STORE)); } catch { /* private mode */ }
    const fromUrl = pick(new URLSearchParams(window.location.search).get('lang'));
    const l = fromUrl || saved || pick(recordLang) || pick(navigator.language) || 'en'; setLangState(l); setChosen(!!(fromUrl || saved));
  }, [recordLang]);
  const setLang = (l: string) => { setLangState(l); setChosen(true); try { window.localStorage.setItem(STORE, l); } catch { /* fine */ } };
  const [dict, setDict] = React.useState<Record<string, Record<string, string>>>({});
  const pending = React.useRef(new Set<string>()); const timer = React.useRef<any>(null); const asked = React.useRef(new Set<string>());
  const flush = React.useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const l = lang; const texts = [...pending.current]; pending.current.clear(); if (!texts.length || l === 'en') return;
      for (let i = 0; i < texts.length; i += 100) {
        const part = texts.slice(i, i + 100); const out = await fetchStrings(l, part).catch(() => null);
        if (out) setDict((d) => { const m = { ...(d[l] || {}) }; part.forEach((s, j) => { if (typeof out[j] === 'string' && out[j]) m[s] = out[j]; }); return { ...d, [l]: m }; });
      }
    }, 40);
  }, [lang, fetchStrings]);
  const t: T = React.useCallback((s, vars) => {
    const src = String(s ?? ''); let out = src;
    if (lang !== 'en' && src.trim()) { const hit = dict[lang]?.[src]; if (hit) out = hit; else if (!asked.current.has(`${lang}|${src}`)) { asked.current.add(`${lang}|${src}`); pending.current.add(src); flush(); } }
    return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? '' : String(vars[k]))) : out;
  }, [lang, dict, flush]);
  const locale = lang === 'en' ? 'en-US' : lang === 'zh' ? 'zh-CN' : lang;
  return { t, lang, setLang, chosen, locale, dir: lang === 'ar' ? 'rtl' as const : 'ltr' as const };
}

export function LangPicker({ lang, setLang, label = 'Language' }: { lang: string; setLang: (l: string) => void; label?: string }) {
  return <label className="mx-auto flex w-fit items-center gap-2 text-[13.5px]" style={{ color: '#6d7075' }}>
    <span aria-hidden>🌐</span><span className="sr-only">{label}</span>
    <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={label} className="h-9 rounded-full border bg-white px-3 text-[13.5px] font-semibold" style={{ borderColor: '#ececee', color: '#16171a' }}>
      {CLIENT_LANGS.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}</select></label>;
}
