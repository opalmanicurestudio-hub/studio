'use client';
// src/components/settings/settings-style.tsx — THE STUDIO LOOK FOR SETTINGS.
// The same paper, ink, accent (the business's own colour), lines and type as the front desk and booking page, so
// Settings no longer feels like a different app. `.cf-legacy` calms the older heavy styling inside the settings
// pages in ONE place — 1px lines instead of thick borders, readable sentence-case labels instead of tiny spaced-out
// capitals, no grey washes or stacked shadows — and is scoped to Settings, so nothing else in the app changes.
import * as React from 'react';
import { DESK_FONT } from '@/components/pos/desk/kit';

export const SETTINGS_CSS = `
.cf-settings{--accent:hsl(var(--primary));--paper:#faf8f5;--ink:#1c1917;--muted:#6b635c;--line:#e7e2dc;--card:#fff;--soft:#f3eee8;
  background:var(--paper);color:var(--ink);font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.dark .cf-settings{--paper:#171412;--ink:#f3eee8;--muted:#b3aaa1;--line:#342e29;--card:#211d1a;--soft:#2a2521}
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
