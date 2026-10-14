'use client';
// src/components/settings/settings-style.tsx — THE STUDIO LOOK FOR SETTINGS.
// The same white (or true black), ink, accent (the business's own colour), lines and type as the front desk and booking page, so
// Settings no longer feels like a different app. `.cf-legacy` calms the older heavy styling inside the settings
// pages in ONE place — 1px lines instead of thick borders, readable sentence-case labels instead of tiny spaced-out
// capitals, no grey washes or stacked shadows — and is scoped to Settings, so nothing else in the app changes.
import * as React from 'react';
import { DESK_FONT } from '@/components/pos/desk/kit';

export const SETTINGS_CSS = `
.cf-settings{--accent:hsl(var(--primary));--accent-ink:hsl(var(--primary-foreground));--ok:#1f7a4d;--warn:#b45309;--danger:#b42318;--paper:#fff;--ink:#16171a;--muted:#6d7075;--line:#ececee;--card:#fff;--soft:#f5f5f7;
  background:var(--paper);color:var(--ink);font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.dark .cf-settings{--ok:#7fd1a5;--warn:#f0b35a;--danger:#ff8a80;--paper:#000;--ink:#f5f5f7;--muted:#9a9ca3;--line:#222226;--card:#0c0c0e;--soft:#18181b}
.cf-settings :focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:12px}
.cf-sheet{background:var(--card);border:1px solid var(--line);border-radius:22px;overflow:hidden}
.cf-row{display:flex;align-items:center;gap:16px;padding:16px 20px;transition:background-color .15s ease}
.cf-row + .cf-row{border-top:1px solid var(--line)}
.cf-row:hover{background:var(--soft)}
.cf-muted{color:var(--muted)}
.cf-accent-wash{background:color-mix(in srgb, var(--accent) 9%, var(--card));border-color:color-mix(in srgb, var(--accent) 28%, var(--line))}
/* theme classes inside this scope: its own --card/--muted are plain colours */
.cf-settings .bg-card{background-color:var(--card)}
.cf-settings .bg-muted{background-color:var(--soft)}
.cf-settings .bg-card\\/5{background-color:color-mix(in srgb,var(--card) 5%,transparent)}
.cf-settings .bg-card\\/10{background-color:color-mix(in srgb,var(--card) 10%,transparent)}
.cf-settings .bg-card\\/20{background-color:color-mix(in srgb,var(--card) 20%,transparent)}
.cf-settings .bg-card\\/30{background-color:color-mix(in srgb,var(--card) 30%,transparent)}
.cf-settings .bg-card\\/40{background-color:color-mix(in srgb,var(--card) 40%,transparent)}
.cf-settings .bg-card\\/50{background-color:color-mix(in srgb,var(--card) 50%,transparent)}
.cf-settings .bg-card\\/60{background-color:color-mix(in srgb,var(--card) 60%,transparent)}
.cf-settings .bg-card\\/70{background-color:color-mix(in srgb,var(--card) 70%,transparent)}
.cf-settings .bg-card\\/80{background-color:color-mix(in srgb,var(--card) 80%,transparent)}
.cf-settings .bg-card\\/90{background-color:color-mix(in srgb,var(--card) 90%,transparent)}
.cf-settings .bg-card\\/95{background-color:color-mix(in srgb,var(--card) 95%,transparent)}
.cf-settings .bg-muted\\/5{background-color:color-mix(in srgb,var(--soft) 5%,transparent)}
.cf-settings .bg-muted\\/10{background-color:color-mix(in srgb,var(--soft) 10%,transparent)}
.cf-settings .bg-muted\\/20{background-color:color-mix(in srgb,var(--soft) 20%,transparent)}
.cf-settings .bg-muted\\/30{background-color:color-mix(in srgb,var(--soft) 30%,transparent)}
.cf-settings .bg-muted\\/40{background-color:color-mix(in srgb,var(--soft) 40%,transparent)}
.cf-settings .bg-muted\\/50{background-color:color-mix(in srgb,var(--soft) 50%,transparent)}
.cf-settings .bg-muted\\/60{background-color:color-mix(in srgb,var(--soft) 60%,transparent)}
.cf-settings .bg-muted\\/70{background-color:color-mix(in srgb,var(--soft) 70%,transparent)}
.cf-settings .bg-muted\\/80{background-color:color-mix(in srgb,var(--soft) 80%,transparent)}
.cf-settings .bg-muted\\/90{background-color:color-mix(in srgb,var(--soft) 90%,transparent)}
.cf-settings .bg-muted\\/95{background-color:color-mix(in srgb,var(--soft) 95%,transparent)}
.cf-settings .hover\\:bg-muted:hover{background-color:var(--soft)}
.cf-settings .text-muted{color:var(--muted)}
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
