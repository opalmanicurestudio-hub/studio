// src/lib/tour-printouts.ts
//
// Print-ready documents for a booth tour (a boothApplications doc, kind:'tour').
// Two audiences, two sheets:
//
//   • visitorConfirmationHtml — hand or email to the visitor: what/when/where,
//     what to bring, and how to reach you. Reassuring, on-brand, one page.
//   • staffPrepSheetHtml      — the internal run-of-show: who's coming, what
//     they want, a walkthrough checklist, and the exact fields to capture for
//     the tour → rental KPIs, with room to write by hand.
//
// NOTHING here is hardcoded to a single business. Two layers feed every sheet:
//   1) Data     — the studio's own record (name/phone/email/address) and the
//                 tour record (guest, space, time, specialty, message, notes).
//   2) Copy     — every headline, list, and note is a TourPrintoutConfig field
//                 the owner can edit (stored on tenants/{id}.tourPrintoutConfig).
//                 When a field is unset, the DEFAULT_TOUR_PRINTOUT_CONFIG value
//                 below is used — so it works out of the box AND is fully
//                 customizable, with no code change.
//
// These are framework-free: each function returns a complete, self-contained
// HTML string in the app's print look (lib/print-style: Plus Jakarta Sans,
// light headings, sentence-case grey labels, thin lines, soft panels). The font
// link is the only outside asset. openPrintable() opens one in a new tab, and
// the sheet's own Print button opens the print dialog.
//
// Everything user-provided (studio, tour, AND custom copy) is HTML-escaped — a
// visitor named "A & B <Studio>" can never break the layout or inject markup.

import { PRINT, PRINT_CSS, PRINT_FONT_HREF, PRINT_FONT_STACK } from './print-style';

export interface TourStudio {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  website?: string | null;
}

// Minimal shape we read off a boothApplications kind:'tour' doc.
export interface TourLike {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  boothName?: string | null;
  tourSlot?: string | null;
  tourStartIso?: string | null;
  tourTimeTBD?: boolean | null;
  specialty?: string | null;
  timing?: string | null;
  moveInDate?: string | null;
  message?: string | null;
  tourNotes?: string | null;
  status?: string | null;
}

// Owner-editable copy for both sheets. Every field is optional; anything left
// out falls back to DEFAULT_TOUR_PRINTOUT_CONFIG. Persisted at
// tenants/{id}.tourPrintoutConfig.
export interface TourPrintoutConfig {
  confirmationTitle?: string;      // visitor sheet headline
  confirmationIntro?: string;      // visitor sheet sub-line
  whatToBringTitle?: string;       // visitor sheet section heading
  whatToBring?: string[];          // visitor sheet checklist items
  changeTimeTitle?: string;        // visitor sheet reschedule heading
  changeTimeNote?: string;         // visitor sheet reschedule body
  prepTitle?: string;              // staff sheet headline
  prepIntro?: string;              // staff sheet sub-line
  checklistTitle?: string;         // staff sheet walkthrough heading
  checklist?: string[];            // staff sheet walkthrough items
  captureTitle?: string;           // staff sheet "capture after tour" heading
  interestLevels?: string[];       // interest tiers — drives sheet, in-app chips, and KPI
  nextSteps?: string[];            // next-step options — drives sheet + in-app chips
  notesTitle?: string;             // staff sheet notes heading
  footerNote?: string;             // extra line on BOTH sheets (e.g. a tagline)
  hideBranding?: boolean;          // hide the "Powered by ClarityFlow" footer
}

export const DEFAULT_TOUR_PRINTOUT_CONFIG: Required<TourPrintoutConfig> = {
  confirmationTitle: "You're booked for a tour",
  confirmationIntro: "We're looking forward to showing you around. Here are your details.",
  whatToBringTitle: 'What to bring',
  whatToBring: [
    'A few questions — anything you want to know about the space, terms, or community.',
    'Your schedule, so we can talk through availability and move-in timing.',
    "If you're licensed, it's helpful to know your license and insurance status.",
  ],
  changeTimeTitle: 'Need to change your time?',
  changeTimeNote: "No problem at all — just reach out and we'll find a slot that works.",
  prepTitle: 'Tour prep sheet',
  prepIntro: 'Internal — run-of-show and what to capture. Not for the visitor.',
  checklistTitle: 'Walkthrough checklist',
  checklist: [
    "Welcome & quick intro — how the studio works, who's here.",
    'Show the space itself — the station, storage, shared areas, restroom.',
    'Amenities & access — hours, keys/entry, wifi, laundry, parking.',
    "Terms — rent, what's included, deposit, and the incidentals policy.",
    'Their business — clientele, products, schedule, growth plans.',
    "Next step — hand them an application or lease if it's a fit.",
  ],
  captureTitle: 'Capture after the tour',
  // The FIRST interest level is the "hottest" tier — it's what the Hot-leads KPI
  // counts. Keep the strongest option first when you customize these.
  interestLevels: ['Hot', 'Warm', 'Cold'],
  nextSteps: ['Send lease', 'Send application', 'Follow up', 'None'],
  notesTitle: 'Notes',
  footerNote: '',
  hideBranding: false,
};

// Merge a partial config over the defaults, dropping empty strings / empty
// arrays so a half-filled config still shows sensible copy.
export function resolveTourPrintoutConfig(cfg?: TourPrintoutConfig | null) {
  const d = DEFAULT_TOUR_PRINTOUT_CONFIG;
  const c = cfg || {};
  const str = (v: any, fb: string) => (typeof v === 'string' && v.trim() ? v : fb);
  const list = (v: any, fb: string[]) => (Array.isArray(v) && v.filter((x) => String(x || '').trim()).length ? v.filter((x: any) => String(x || '').trim()) : fb);
  return {
    confirmationTitle: str(c.confirmationTitle, d.confirmationTitle),
    confirmationIntro: str(c.confirmationIntro, d.confirmationIntro),
    whatToBringTitle: str(c.whatToBringTitle, d.whatToBringTitle),
    whatToBring: list(c.whatToBring, d.whatToBring),
    changeTimeTitle: str(c.changeTimeTitle, d.changeTimeTitle),
    changeTimeNote: str(c.changeTimeNote, d.changeTimeNote),
    prepTitle: str(c.prepTitle, d.prepTitle),
    prepIntro: str(c.prepIntro, d.prepIntro),
    checklistTitle: str(c.checklistTitle, d.checklistTitle),
    checklist: list(c.checklist, d.checklist),
    captureTitle: str(c.captureTitle, d.captureTitle),
    interestLevels: list(c.interestLevels, d.interestLevels),
    nextSteps: list(c.nextSteps, d.nextSteps),
    notesTitle: str(c.notesTitle, d.notesTitle),
    footerNote: str(c.footerNote, ''),
    hideBranding: !!c.hideBranding,
  };
}

const esc = (v: any): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// A friendly when-string. Prefer the stored human slot label (already localized
// when booked); fall back to the ISO instant; else "to be confirmed".
export function tourWhen(tour: TourLike): string {
  if (tour.tourTimeTBD) return 'Time to be confirmed';
  if (tour.tourSlot) return String(tour.tourSlot);
  if (tour.tourStartIso) {
    const d = new Date(tour.tourStartIso);
    if (!isNaN(d.getTime())) {
      try {
        return d.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      } catch { /* fall through */ }
    }
  }
  return 'Time to be confirmed';
}

const todayLabel = (): string => {
  try { return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
};

const sentence = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Shared page chrome: a toolbar that stays on screen (never on paper), the
// studio's name over the sheet's title, then the body and a quiet footer.
function page(o: { title: string; studioName: string; heading: string; intro: string; body: string; footerNote: string; hideBranding: boolean }): string {
  const footLeft = [esc(o.studioName), o.footerNote ? esc(o.footerNote) : ''].filter(Boolean).join(' · ');
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(o.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="${PRINT_FONT_HREF}" rel="stylesheet" />
<style>
  @page { margin: 0.5in; }
  ${PRINT_CSS}
  .toolbar { position: sticky; top: 0; z-index: 1; display: flex; gap: 8px; justify-content: center; padding: 12px; background: ${PRINT.soft}; font-family: ${PRINT_FONT_STACK}; }
  .toolbar button { font: inherit; font-size: 13px; font-weight: 600; color: #fff; background: ${PRINT.ink}; border: 1px solid ${PRINT.ink}; border-radius: 999px; padding: 9px 20px; cursor: pointer; }
  .toolbar button.quiet { color: ${PRINT.ink}; background: #fff; border-color: ${PRINT.line}; }
  .pp .when { background: ${PRINT.soft}; border-radius: 14px; padding: 14px 16px; margin: 0 0 14px; break-inside: avoid; }
  .pp .when .big { font-size: 22px; font-weight: 300; letter-spacing: -0.01em; line-height: 1.25; margin-top: 3px; }
  .pp .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 28px; }
  .pp .fact { padding: 8px 0; border-bottom: 1px solid ${PRINT.line}; break-inside: avoid; }
  .pp .fact .v { font-size: 13.5px; font-weight: 500; margin-top: 1px; }
  .pp ul.check { list-style: none; margin: 0; padding: 0; }
  .pp ul.check li { display: flex; align-items: flex-start; gap: 10px; padding: 7px 0; border-bottom: 1px solid ${PRINT.line}; font-size: 13px; color: ${PRINT.body}; break-inside: avoid; }
  .pp .ck { flex: 0 0 auto; width: 14px; height: 14px; margin-top: 2px; border: 1px solid ${PRINT.faint}; border-radius: 4px; }
  .pp .said { margin: 0; padding: 12px 14px; border-radius: 12px; background: ${PRINT.soft}; color: ${PRINT.body}; font-size: 13px; white-space: pre-wrap; break-inside: avoid; }
  .pp .opts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .pp .opt { display: inline-block; padding: 4px 12px; border-radius: 999px; background: ${PRINT.soft}; color: ${PRINT.body}; font-size: 12px; font-weight: 500; }
  .pp .ln { height: 28px; border-bottom: 1px solid ${PRINT.line}; }
</style></head>
<body class="pp-screen">
  <div class="toolbar no-print">
    <button type="button" onclick="window.print()">Print</button>
    <button type="button" class="quiet" onclick="window.close()">Close</button>
  </div>
  <div class="pp page">
    <div class="head">
      <div><p class="shop">${esc(o.studioName)}</p><h1>${esc(o.heading)}</h1><p class="sub">${esc(o.intro)}</p></div>
      <div class="meta"><div>Printed ${esc(todayLabel())}</div></div>
    </div>
    ${o.body}
    <div class="foot"><span>${footLeft}</span><span>${o.hideBranding ? '' : 'Powered by ClarityFlow'}</span></div>
  </div>
  <script>try{window.focus();}catch(e){}</script>
</body></html>`;
}

function row(k: string, v: any): string {
  const val = String(v ?? '').trim();
  if (!val) return '';
  return `<div class="fact"><div class="lbl">${esc(k)}</div><div class="v">${esc(val)}</div></div>`;
}

function checklistItems(items: string[]): string {
  return items.map((it) => `<li><span class="ck"></span><span>${esc(it)}</span></li>`).join('');
}

// ── Visitor confirmation ─────────────────────────────────────────────────────
export function visitorConfirmationHtml(tour: TourLike, studio: TourStudio = {}, config?: TourPrintoutConfig | null): string {
  const studioName = String(studio.name || 'Our studio');
  const c = resolveTourPrintoutConfig(config);
  const contactBits = [
    studio.phone ? `Call or text ${studio.phone}` : '',
    studio.email || '',
    studio.website || '',
  ].filter(Boolean).map(esc).join(' · ');

  const body = `
    <div class="when">
      <div class="lbl">When</div>
      <div class="big">${esc(tourWhen(tour))}</div>
    </div>

    <div class="facts">
      ${row('Guest', tour.name)}
      ${row('Space', tour.boothName || 'Studio tour')}
      ${studio.address ? row('Where', studio.address) : ''}
      ${tour.specialty ? row('Your specialty', tour.specialty) : ''}
    </div>

    <h2>${esc(c.whatToBringTitle)}</h2>
    <ul class="check">
      ${checklistItems(c.whatToBring)}
    </ul>

    <h2>${esc(c.changeTimeTitle)}</h2>
    <p class="said">${esc(c.changeTimeNote)}${contactBits ? `\n${esc(studioName)}: ${contactBits}` : ''}</p>
  `;
  return page({ title: 'Tour confirmation', studioName, heading: c.confirmationTitle, intro: c.confirmationIntro, body, footerNote: c.footerNote, hideBranding: c.hideBranding });
}

// ── Staff prep sheet ─────────────────────────────────────────────────────────
export function staffPrepSheetHtml(tour: TourLike, studio: TourStudio = {}, config?: TourPrintoutConfig | null): string {
  const studioName = String(studio.name || 'Studio');
  const c = resolveTourPrintoutConfig(config);
  const contact = [tour.phone, tour.email].filter(Boolean).map(esc).join(' · ');

  const body = `
    <div class="when">
      <div class="lbl">${esc(tour.name || 'Visitor')} · ${esc(tour.boothName || 'Studio tour')}</div>
      <div class="big">${esc(tourWhen(tour))}</div>
    </div>

    <div class="facts">
      ${row('Visitor', tour.name)}
      ${contact ? `<div class="fact"><div class="lbl">Contact</div><div class="v">${contact}</div></div>` : ''}
      ${row('Specialty', tour.specialty)}
      ${row('Timing', tour.timing)}
      ${row('Move-in', tour.moveInDate)}
      ${row('Status', sentence((tour.status || 'requested').replace(/_/g, ' ')))}
    </div>

    ${tour.message ? `<h2>What they said</h2><p class="said">${esc(tour.message)}</p>` : ''}
    ${tour.tourNotes ? `<h2>Prior notes</h2><p class="said">${esc(tour.tourNotes)}</p>` : ''}

    <h2>${esc(c.checklistTitle)}</h2>
    <ul class="check">
      ${checklistItems(c.checklist)}
    </ul>

    <h2>${esc(c.captureTitle)}</h2>
    <div class="facts">
      <div class="fact">
        <div class="lbl">Interest level</div>
        <div class="opts">${c.interestLevels.map((v) => `<span class="opt">${esc(v)}</span>`).join('')}</div>
      </div>
      <div class="fact">
        <div class="lbl">Next step</div>
        <div class="opts">${c.nextSteps.filter((v) => v && v.toLowerCase() !== 'none').map((v) => `<span class="opt">${esc(v)}</span>`).join('')}</div>
      </div>
    </div>

    <h2>${esc(c.notesTitle)}</h2>
    <div class="ln"></div><div class="ln"></div><div class="ln"></div><div class="ln"></div>
  `;
  return page({ title: 'Tour prep sheet', studioName, heading: c.prepTitle, intro: c.prepIntro, body, footerNote: c.footerNote, hideBranding: c.hideBranding });
}

// Open a generated HTML document in a new tab; the document's own Print button
// (or its own script) opens the print dialog.
// Returns false if a popup blocker prevented it (caller can surface a hint).
export function openPrintable(html: string): boolean {
  if (typeof window === 'undefined') return false;
  const w = window.open('', '_blank', 'width=880,height=1000');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  try {
    w.onload = () => { try { w.focus(); } catch { /* noop */ } };
  } catch { /* noop */ }
  return true;
}
