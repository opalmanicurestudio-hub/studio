'use client';
// src/components/settings/settings-style.tsx — THE STUDIO LOOK FOR SETTINGS.
// The same paper, ink, accent (the business's own colour), lines and type as the front desk and booking page, so
// Settings no longer feels like a different app. `.cf-legacy` calms the older heavy styling inside the settings
// pages in ONE place — 1px lines instead of thick borders, readable sentence-case labels instead of tiny spaced-out
// capitals, no grey washes or stacked shadows — and is scoped to Settings, so nothing else in the app changes.
import * as React from 'react';
import { DESK_FONT } from '@/components/pos/desk/kit';

export const SETTINGS_CSS = `
.cf-settings{--accent:hsl(var(--primary));--accent-ink:#fff;--ok:#15803d;--warn:#b45309;--danger:#b91c1c;--paper:#faf8f5;--ink:#1c1917;--muted:#6b635c;--line:#e7e2dc;--card:#fff;--soft:#f3eee8;
  background:var(--paper);color:var(--ink);font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.dark .cf-settings{--ok:#4ade80;--warn:#fbbf24;--danger:#f87171;--paper:#171412;--ink:#f3eee8;--muted:#b3aaa1;--line:#342e29;--card:#211d1a;--soft:#2a2521}
.cf-settings :focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:12px}
.cf-sheet{background:var(--card);border:1px solid var(--line);border-radius:22px;overflow:hidden}
.cf-row{display:flex;align-items:center;gap:16px;padding:16px 20px;transition:background-color .15s ease}
.cf-row + .cf-row{border-top:1px solid var(--line)}
.cf-row:hover{background:var(--soft)}
.cf-muted{color:var(--muted)}
.cf-accent-wash{background:color-mix(in srgb, var(--accent) 9%, var(--card));border-color:color-mix(in srgb, var(--accent) 28%, var(--line))}
@media (prefers-reduced-motion: reduce){.cf-row{transition:none}}
/* ── calming the older settings pages (scoped) ── */
.cf-legacy .border-2{border-width:1px!important;border-color:var(--line)}
.cf-legacy [class*="rounded-[2"]{border-radius:22px!important}
.cf-legacy .shadow-sm,.cf-legacy .shadow-inner,.cf-legacy .shadow-lg,.cf-legacy .shadow-xl,.cf-legacy .shadow-2xl{box-shadow:none!important}
.cf-legacy .bg-muted\\/5,.cf-legacy .bg-slate-50\\/50,.cf-legacy .bg-muted\\/10{background:transparent!important}
.cf-legacy .bg-white{background:var(--card)!important}
.cf-legacy .text-\\[9px\\],.cf-legacy .text-\\[10px\\]{font-size:12.5px!important;letter-spacing:0!important;text-transform:none!important;line-height:1.45}
.cf-legacy .text-\\[7px\\],.cf-legacy .text-\\[8px\\]{font-size:12.5px!important;letter-spacing:0!important;text-transform:none!important;line-height:1.45}
.cf-legacy .border-dashed{border-style:solid!important;border-color:var(--line)!important}
.cf-legacy [class*="bg-emerald-"]:not([class*="bg-emerald-50"]):not([class*="bg-emerald-100"]),.cf-legacy [class*="bg-green-"]:not([class*="bg-green-50"]):not([class*="bg-green-100"]){background-color:var(--ok)!important;color:#fff}
.cf-legacy [class*="bg-emerald-50"],.cf-legacy [class*="bg-emerald-100"],.cf-legacy [class*="bg-green-50"],.cf-legacy [class*="bg-green-100"]{background-color:color-mix(in srgb,var(--ok) 12%,transparent)!important}
.cf-legacy [class*="text-emerald-"],.cf-legacy [class*="text-green-"]{color:var(--ok)!important}
.cf-legacy [class*="bg-amber-"]:not([class*="bg-amber-50"]):not([class*="bg-amber-100"]),.cf-legacy [class*="bg-orange-"]:not([class*="bg-orange-50"]):not([class*="bg-orange-100"]){background-color:var(--warn)!important;color:#fff}
.cf-legacy [class*="bg-amber-50"],.cf-legacy [class*="bg-amber-100"],.cf-legacy [class*="bg-orange-50"],.cf-legacy [class*="bg-orange-100"]{background-color:color-mix(in srgb,var(--warn) 12%,transparent)!important}
.cf-legacy [class*="text-amber-"],.cf-legacy [class*="text-orange-"]{color:var(--warn)!important}
.cf-legacy [class*="bg-rose-"]:not([class*="bg-rose-50"]):not([class*="bg-rose-100"]),.cf-legacy [class*="bg-red-"]:not([class*="bg-red-50"]):not([class*="bg-red-100"]){background-color:var(--danger)!important;color:#fff}
.cf-legacy [class*="bg-rose-50"],.cf-legacy [class*="bg-rose-100"],.cf-legacy [class*="bg-red-50"],.cf-legacy [class*="bg-red-100"]{background-color:color-mix(in srgb,var(--danger) 12%,transparent)!important}
.cf-legacy [class*="text-rose-"],.cf-legacy [class*="text-red-"]{color:var(--danger)!important}
.cf-legacy [class*="bg-violet-"]:not([class*="bg-violet-50"]):not([class*="bg-violet-100"]),.cf-legacy [class*="bg-indigo-"]:not([class*="bg-indigo-50"]):not([class*="bg-indigo-100"]),.cf-legacy [class*="bg-sky-"]:not([class*="bg-sky-50"]):not([class*="bg-sky-100"]){background-color:var(--accent)!important;color:var(--accent-ink)}
.cf-legacy [class*="bg-violet-50"],.cf-legacy [class*="bg-violet-100"],.cf-legacy [class*="bg-indigo-50"],.cf-legacy [class*="bg-indigo-100"],.cf-legacy [class*="bg-sky-50"],.cf-legacy [class*="bg-sky-100"]{background-color:color-mix(in srgb,var(--accent) 12%,transparent)!important}
.cf-legacy [class*="text-violet-"],.cf-legacy [class*="text-indigo-"],.cf-legacy [class*="text-sky-"]{color:var(--accent)!important}
.cf-legacy [class*="text-slate-9"],.cf-legacy [class*="text-stone-9"],.cf-legacy [class*="text-gray-9"]{color:var(--ink)!important}
.cf-legacy [class*="text-slate-5"],.cf-legacy [class*="text-slate-6"],.cf-legacy [class*="text-stone-5"],.cf-legacy [class*="text-stone-6"],.cf-legacy [class*="text-gray-5"],.cf-legacy [class*="text-gray-6"]{color:var(--muted)!important}
.cf-legacy [class*="bg-slate-50"],.cf-legacy [class*="bg-slate-100"],.cf-legacy [class*="bg-stone-50"],.cf-legacy [class*="bg-stone-100"],.cf-legacy [class*="bg-gray-50"],.cf-legacy [class*="bg-gray-100"]{background-color:var(--soft)!important}
.cf-legacy .tracking-widest,.cf-legacy .tracking-wider,.cf-legacy [class*="tracking-[0."]{letter-spacing:0!important}
.cf-legacy .uppercase{text-transform:none!important}
.cf-legacy .font-black,.cf-legacy .font-extrabold{font-weight:600!important}
.cf-legacy .opacity-60{opacity:1!important;color:var(--muted)}
.cf-legacy .text-slate-900{color:var(--ink)!important}
.cf-legacy .text-muted-foreground{color:var(--muted)!important}
`;

/** Studio styles + the font, once per settings screen. */
export function SettingsStyle() {
  return (<>
    <link rel="stylesheet" href={DESK_FONT} />
    <style dangerouslySetInnerHTML={{ __html: SETTINGS_CSS }} />
  </>);
}
