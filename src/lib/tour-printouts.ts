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
// These are framework-free: each function returns a complete, self-contained
// HTML string (inline CSS, no external assets) so it prints identically
// anywhere. openPrintable() opens one in a new tab and fires the print dialog.
//
// Everything user-provided is HTML-escaped — a visitor named "A & B <Studio>"
// can never break the layout or inject markup.

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

// Shared page chrome: print button (hidden on paper), studio wordmark, footer.
function page(title: string, studioName: string, innerHtml: string): string {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --accent:#4f46e5; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:#f1f5f9; color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .toolbar { position:sticky; top:0; display:flex; gap:8px; justify-content:center;
    padding:14px; background:#0f172a; }
  .toolbar button { font:inherit; font-weight:800; font-size:12px; letter-spacing:.08em;
    text-transform:uppercase; color:#0f172a; background:#fff; border:0; border-radius:10px;
    padding:10px 18px; cursor:pointer; }
  .toolbar button.secondary { background:transparent; color:#fff; border:1px solid #334155; }
  .sheet { max-width:760px; margin:24px auto; background:#fff; border:1px solid var(--line);
    border-radius:14px; padding:40px 44px; box-shadow:0 10px 40px rgba(15,23,42,.08); }
  .brand { font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:var(--muted);
    margin:0 0 4px; }
  h1 { font-size:26px; letter-spacing:-.02em; margin:0 0 2px; }
  .sub { color:var(--muted); font-size:13px; margin:0 0 22px; }
  .hero { border:2px solid var(--ink); border-radius:12px; padding:18px 20px; margin:0 0 24px; }
  .hero .lbl { font-size:10px; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); }
  .hero .big { font-size:20px; font-weight:800; letter-spacing:-.01em; margin-top:2px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px 28px; margin:0 0 22px; }
  .row { border-bottom:1px solid var(--line); padding:9px 0; }
  .row .k { font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); }
  .row .v { font-size:15px; font-weight:600; margin-top:1px; }
  h2 { font-size:12px; letter-spacing:.16em; text-transform:uppercase; color:var(--accent);
    margin:26px 0 10px; }
  ul.check { list-style:none; margin:0; padding:0; }
  ul.check li { display:flex; align-items:flex-start; gap:10px; padding:7px 0; font-size:14px;
    border-bottom:1px solid #f1f5f9; }
  .box { display:inline-block; width:15px; height:15px; border:2px solid var(--ink); border-radius:4px;
    margin-top:1px; flex:0 0 auto; }
  .lines { margin-top:8px; }
  .lines .ln { border-bottom:1px solid var(--line); height:26px; }
  .pill { display:inline-block; border:1.5px solid var(--ink); border-radius:999px;
    padding:5px 12px; font-size:12px; font-weight:800; margin:0 6px 6px 0; }
  .note { background:#f8fafc; border:1px solid var(--line); border-radius:10px; padding:12px 14px;
    font-size:14px; color:#334155; white-space:pre-wrap; }
  .foot { margin-top:30px; padding-top:14px; border-top:1px solid var(--line);
    font-size:11px; color:#94a3b8; text-align:center; }
  @media print {
    body { background:#fff; }
    .toolbar { display:none; }
    .sheet { margin:0; border:0; border-radius:0; box-shadow:none; padding:0.4in 0.5in; max-width:none; }
    @page { margin:0.5in; }
  }
</style></head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">Print</button>
    <button class="secondary" onclick="window.close()">Close</button>
  </div>
  <div class="sheet">
    <p class="brand">${esc(studioName)}</p>
    ${innerHtml}
    <div class="foot">${esc(studioName)} · Generated ${esc(todayLabel())} · Powered by ClarityFlow</div>
  </div>
  <script>try{window.focus();}catch(e){}</script>
</body></html>`;
}

function row(k: string, v: any): string {
  const val = String(v ?? '').trim();
  if (!val) return '';
  return `<div class="row"><div class="k">${esc(k)}</div><div class="v">${esc(val)}</div></div>`;
}

// ── Visitor confirmation ─────────────────────────────────────────────────────
export function visitorConfirmationHtml(tour: TourLike, studio: TourStudio = {}): string {
  const studioName = String(studio.name || 'Our studio');
  const contactBits = [
    studio.phone ? `Call or text ${esc(studio.phone)}` : '',
    studio.email ? esc(studio.email) : '',
    studio.website ? esc(studio.website) : '',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');

  const inner = `
    <h1>You're booked for a tour</h1>
    <p class="sub">We're looking forward to showing you around. Here are your details.</p>

    <div class="hero">
      <div class="lbl">When</div>
      <div class="big">${esc(tourWhen(tour))}</div>
    </div>

    <div class="grid">
      ${row('Guest', tour.name)}
      ${row('Space', tour.boothName || 'Studio tour')}
      ${studio.address ? row('Where', studio.address) : ''}
      ${tour.specialty ? row('Your specialty', tour.specialty) : ''}
    </div>

    <h2>What to bring</h2>
    <ul class="check">
      <li><span class="box"></span> A few questions — anything you want to know about the space, terms, or community.</li>
      <li><span class="box"></span> Your schedule, so we can talk through availability and move-in timing.</li>
      <li><span class="box"></span> If you're licensed, it's helpful to know your license and insurance status.</li>
    </ul>

    <h2>Need to change your time?</h2>
    <p class="note">No problem at all — just reach out and we'll find a slot that works.${contactBits ? `\n${studioName}: ${contactBits.replace(/&nbsp;/g, ' ').replace(/·/g, '·')}` : ''}</p>
  `;
  return page('Tour confirmation', studioName, inner);
}

// ── Staff prep sheet ─────────────────────────────────────────────────────────
export function staffPrepSheetHtml(tour: TourLike, studio: TourStudio = {}): string {
  const studioName = String(studio.name || 'Studio');
  const contact = [tour.phone, tour.email].filter(Boolean).map(esc).join(' · ');

  const inner = `
    <h1>Tour prep sheet</h1>
    <p class="sub">Internal — run-of-show and what to capture. Not for the visitor.</p>

    <div class="hero">
      <div class="lbl">${esc(tour.name || 'Visitor')} &nbsp;·&nbsp; ${esc(tour.boothName || 'Studio tour')}</div>
      <div class="big">${esc(tourWhen(tour))}</div>
    </div>

    <div class="grid">
      ${row('Visitor', tour.name)}
      ${contact ? `<div class="row"><div class="k">Contact</div><div class="v">${contact}</div></div>` : ''}
      ${row('Specialty', tour.specialty)}
      ${row('Timing', tour.timing)}
      ${row('Move-in', tour.moveInDate)}
      ${row('Status', (tour.status || 'requested').replace(/_/g, ' '))}
    </div>

    ${tour.message ? `<h2>What they said</h2><p class="note">${esc(tour.message)}</p>` : ''}
    ${tour.tourNotes ? `<h2>Prior notes</h2><p class="note">${esc(tour.tourNotes)}</p>` : ''}

    <h2>Walkthrough checklist</h2>
    <ul class="check">
      <li><span class="box"></span> Welcome &amp; quick intro — how the studio works, who's here.</li>
      <li><span class="box"></span> Show the space itself — the station, storage, shared areas, restroom.</li>
      <li><span class="box"></span> Amenities &amp; access — hours, keys/entry, wifi, laundry, parking.</li>
      <li><span class="box"></span> Terms — rent, what's included, deposit, and the incidentals policy.</li>
      <li><span class="box"></span> Their business — clientele, products, schedule, growth plans.</li>
      <li><span class="box"></span> Next step — hand them an application or lease if it's a fit.</li>
    </ul>

    <h2>Capture after the tour</h2>
    <div class="grid" style="margin-bottom:8px;">
      <div>
        <div class="row"><div class="k">Interest level</div>
          <div class="v" style="margin-top:6px;">
            <span class="pill">Hot</span><span class="pill">Warm</span><span class="pill">Cold</span>
          </div>
        </div>
      </div>
      <div>
        <div class="row"><div class="k">Next step</div>
          <div class="v" style="margin-top:6px;">
            <span class="pill">Send lease</span><span class="pill">Send application</span><span class="pill">Follow up</span>
          </div>
        </div>
      </div>
    </div>

    <h2>Notes</h2>
    <div class="lines">
      <div class="ln"></div><div class="ln"></div><div class="ln"></div><div class="ln"></div>
    </div>
  `;
  return page('Tour prep sheet', studioName, inner);
}

// Open a generated HTML document in a new tab and trigger the print dialog.
// Returns false if a popup blocker prevented it (caller can surface a hint).
export function openPrintable(html: string): boolean {
  if (typeof window === 'undefined') return false;
  const w = window.open('', '_blank', 'width=880,height=1000');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Give the new document a tick to lay out before the print dialog.
  try {
    w.onload = () => { try { w.focus(); } catch { /* noop */ } };
  } catch { /* noop */ }
  return true;
}
