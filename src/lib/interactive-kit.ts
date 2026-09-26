// src/lib/interactive-kit.ts
//
// THE INTERACTIVE KIT — why AI-built interactives look like ClarityFlow and
// arrive working:
//   KIT_CSS      the app's look inside the sealed frame: Plus Jakarta Sans,
//                stone palette, the school's brand colour (--cf-accent), rounded
//                cards, styled buttons / toggles / sliders / readouts, SVG
//                colour classes, reduced-motion handling
//   KIT_GUIDE    what Claude is told to use (classes, variables, rules)
//   KIT_EXAMPLE  a worked example of the expected quality, built with the kit
//   extractHtml  pulls the HTML out of Claude's reply; refuses anything cut off
//   scriptError  compiles every inline <script> (without running it) so a
//                syntax error is caught on the server, before anyone sees it

export const KIT_CSS = `
:root{--cf-ink:#1c1917;--cf-ink-2:#44403c;--cf-muted:#78716c;--cf-line:#e7e5e4;--cf-paper:#f7f5f2;--cf-card:#ffffff;
--cf-accent:#7c3aed;--cf-accent-soft:color-mix(in srgb,var(--cf-accent) 14%,white);--cf-accent-ink:color-mix(in srgb,var(--cf-accent) 70%,black);
--cf-ok:#059669;--cf-ok-soft:#d1fae5;--cf-warn:#d97706;--cf-warn-soft:#fef3c7;--cf-bad:#dc2626;--cf-bad-soft:#fee2e2;
--cf-skin:#f2c9ae;--cf-skin-line:#b98468;--cf-nail:#f6e7df;--cf-nail-line:#c9a99a;--cf-radius:18px}
*{box-sizing:border-box}
html,body{margin:0;background:transparent;color:var(--cf-ink);font:15px/1.55 "Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
body{padding:4px}
.cf-card{background:var(--cf-card);border:1px solid var(--cf-line);border-radius:var(--cf-radius);padding:16px;box-shadow:0 12px 40px -24px rgba(28,25,23,.35)}
.cf-title{font-size:22px;font-weight:300;letter-spacing:-.02em;line-height:1.2;margin:0 0 4px}.cf-title b{font-weight:600;color:var(--cf-accent)}
.cf-sub{font-size:13px;color:var(--cf-muted);margin:0 0 12px}
.cf-eyebrow{font-size:10.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--cf-muted)}
.cf-stage{background:var(--cf-paper);border-radius:14px;padding:8px;margin:8px 0 12px}.cf-stage svg,.cf-stage canvas{display:block;width:100%;height:auto}
.cf-row{display:flex;align-items:center;gap:10px;margin:10px 0;flex-wrap:wrap}.cf-label{font-size:13px;font-weight:600;color:var(--cf-ink-2);min-width:56px}
.cf-btn{min-height:42px;padding:8px 16px;border-radius:999px;border:1.5px solid var(--cf-line);background:var(--cf-card);color:var(--cf-ink);font:600 14px/1 inherit;cursor:pointer;transition:transform .12s,background .2s}
.cf-btn:active{transform:scale(.97)}.cf-btn.primary{background:var(--cf-accent);border-color:var(--cf-accent);color:#fff}
.cf-seg{display:inline-flex;flex-wrap:wrap;gap:4px;background:var(--cf-paper);border-radius:999px;padding:4px}
.cf-seg button{min-height:36px;padding:6px 14px;border:0;border-radius:999px;background:transparent;color:var(--cf-ink-2);font:600 13px/1 inherit;cursor:pointer}
.cf-seg button.on{background:var(--cf-card);color:var(--cf-accent-ink);box-shadow:0 2px 8px -4px rgba(28,25,23,.4)}
input[type=range].cf-range{flex:1;min-width:90px;accent-color:var(--cf-accent);height:28px}
.cf-readout{font-variant-numeric:tabular-nums;font-weight:600;min-width:56px;text-align:right}
.cf-note{font-size:14px;line-height:1.5;color:var(--cf-ink-2);background:var(--cf-paper);border-radius:14px;padding:10px 12px;margin-top:8px}
.cf-note.ok{background:var(--cf-ok-soft);color:#065f46}.cf-note.warn{background:var(--cf-warn-soft);color:#92400e}.cf-note.bad{background:var(--cf-bad-soft);color:#991b1b}
.cf-pill{display:inline-block;font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;background:var(--cf-accent-soft);color:var(--cf-accent-ink)}
.cf-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--cf-muted)}.cf-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
/* SVG helpers */
.s-accent{fill:var(--cf-accent)}.s-accent-soft{fill:var(--cf-accent-soft)}.s-ink{fill:var(--cf-ink)}.s-muted{fill:var(--cf-muted)}.s-paper{fill:var(--cf-paper)}
.s-ok{fill:var(--cf-ok)}.s-warn{fill:var(--cf-warn)}.s-bad{fill:var(--cf-bad)}.s-skin{fill:var(--cf-skin);stroke:var(--cf-skin-line)}.s-nail{fill:var(--cf-nail);stroke:var(--cf-nail-line)}
.s-line{fill:none;stroke:var(--cf-line);stroke-width:1.5}.s-line-accent{fill:none;stroke:var(--cf-accent);stroke-width:2}
.s-text{fill:var(--cf-ink-2);font:500 12px "Plus Jakarta Sans",system-ui,sans-serif}.s-text-muted{fill:var(--cf-muted);font:500 11px "Plus Jakarta Sans",system-ui,sans-serif}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition:none!important}}
`;

export const KIT_GUIDE = `STYLE KIT (already loaded in the page — use it; do not restyle the basics):
- Wrap everything in <div class="cf-card">. Title: <p class="cf-title">Light words <b>key word</b></p>, then <p class="cf-sub">one line</p>.
- Put the drawing in <div class="cf-stage"> containing an <svg viewBox="…" width="100%"> (or a <canvas>).
- Controls: rows <div class="cf-row"><span class="cf-label">Time</span><input type="range" class="cf-range"> <span class="cf-readout">0 s</span></div>;
  toggles <div class="cf-seg"><button class="on">A</button><button>B</button></div>; buttons <button class="cf-btn primary">Play</button> / <button class="cf-btn">Reset</button>.
- Live explanation: <p class="cf-note">…</p> (add class ok / warn / bad for outcomes). Small tags: <span class="cf-pill">. Legend: <div class="cf-legend"><span><i style="background:var(--cf-accent)"></i>Cured</span></div>.
- Colours come ONLY from the kit: CSS variables var(--cf-accent) (the school's brand colour), --cf-accent-soft, --cf-ink, --cf-muted, --cf-line, --cf-paper, --cf-ok/-warn/-bad (+ -soft), --cf-skin, --cf-nail.
  In SVG use the classes s-accent, s-accent-soft, s-ink, s-muted, s-paper, s-ok, s-warn, s-bad, s-skin, s-nail, s-line, s-line-accent, s-text, s-text-muted (or style="fill:var(--cf-…)"). Never hard-code other colours.
- Font is already Plus Jakarta Sans; don't set fonts. Keep text short and readable (14px+ for body, 11px+ in SVG).`;

export const KIT_EXAMPLE = `<div class="cf-card">
  <p class="cf-eyebrow">Gel science</p>
  <p class="cf-title">How gel <b>cures</b></p>
  <p class="cf-sub">Light links liquid gel into a solid network — from the top down.</p>
  <div class="cf-stage"><svg viewBox="0 0 640 220" width="100%" role="img" aria-label="Gel layer under a lamp">
    <rect x="170" y="10" width="300" height="30" rx="8" class="s-ink"/><rect id="lamp" x="180" y="36" width="280" height="6" rx="3" class="s-muted"/>
    <g id="gel"></g><rect x="80" y="180" width="480" height="18" rx="5" class="s-nail"/><text x="320" y="194" text-anchor="middle" class="s-text-muted">Natural nail</text>
  </svg></div>
  <div class="cf-row"><span class="cf-label">Time</span><input id="t" type="range" class="cf-range" min="0" max="60" value="0"><span id="to" class="cf-readout">0 s</span></div>
  <div class="cf-row"><span class="cf-label">Coat</span><div class="cf-seg" id="coat"><button class="on" data-v="3">Thin</button><button data-v="6">Thick</button></div></div>
  <p id="out" class="cf-note">Drag the time slider to switch on the lamp.</p>
  <div class="cf-legend"><span><i style="background:var(--cf-accent-soft)"></i>Liquid</span><span><i style="background:var(--cf-accent)"></i>Cured</span></div>
</div>
<script>
(function(){
  var rows=3, t=0;
  function draw(){
    var g=document.getElementById('gel'), h='', cell=22, bottom=178, top=bottom-rows*cell, solid=0;
    for(var r=0;r<rows;r++){
      var light=Math.exp(-0.28*r), cured=t*light>=12; if(cured) solid++;
      for(var i=0;i<20;i++){ var x=98+i*23, y=top+r*cell+cell/2;
        if(cured&&i<19) h+='<line x1="'+x+'" y1="'+y+'" x2="'+(x+23)+'" y2="'+y+'" class="s-line-accent"/>';
        h+='<circle cx="'+x+'" cy="'+y+'" r="5" class="'+(cured?'s-accent':'s-accent-soft')+'"/>'; }
    }
    g.innerHTML=h; document.getElementById('to').textContent=t+' s';
    document.getElementById('lamp').setAttribute('class', t>0?'s-accent':'s-muted');
    var out=document.getElementById('out');
    if(t===0){out.className='cf-note';out.textContent='Drag the time slider to switch on the lamp.';}
    else if(solid===rows){out.className='cf-note ok';out.textContent='Fully cured — every layer has linked into a solid network.';}
    else if(t>=60){out.className='cf-note bad';out.textContent='Still liquid underneath: light can’t reach the bottom of a thick coat. Uncured gel can lift and cause skin reactions.';}
    else {out.className='cf-note';out.textContent='Curing from the top down: '+solid+' of '+rows+' layers solid.';}
  }
  document.getElementById('t').addEventListener('input',function(e){t=Number(e.target.value);draw();});
  document.querySelectorAll('#coat button').forEach(function(b){b.addEventListener('click',function(){
    document.querySelectorAll('#coat button').forEach(function(x){x.classList.toggle('on',x===b);}); rows=Number(b.dataset.v); draw(); });});
  draw();
})();
</script>`;

/** Pull the HTML out of Claude's reply. Refuses output that was cut off. */
export function extractHtml(text: string, stopReason?: string | null): { html: string | null; error?: string } {
  if (stopReason === 'max_tokens') return { html: null, error: 'The interactive was too big to finish — try a simpler request, or split it into two.' };
  const fenced = text.match(/```html\s*([\s\S]*?)```/);
  const html = (fenced ? fenced[1] : '').trim();
  if (!html) return { html: null, error: 'The interactive didn’t come back complete — try again.' };
  // Unclosed <script> or <svg> means the piece is incomplete.
  const opens = (re: RegExp) => (html.match(re) || []).length;
  if (opens(/<script\b/gi) !== opens(/<\/script>/gi) || opens(/<svg\b/gi) !== opens(/<\/svg>/gi)) return { html: null, error: 'The interactive came back incomplete — try again.' };
  return { html };
}

/** Compile each inline script without running it; returns the first syntax error. */
export function scriptError(html: string): string | null {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const code of scripts) {
    try { new Function(code); } catch (e: any) { return String(e?.message || e).slice(0, 300); }
  }
  return null;
}
