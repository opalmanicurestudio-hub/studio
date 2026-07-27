<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ClarityFlow — interactive landing prototype</title>
<style>
  :root{
    --bg:#ffffff; --fg:#0b1120; --muted:#64748b; --line:#e2e8f0;
    --card:#ffffff; --soft:#f6f7fb;
    --p:#7c3aed; --p-soft:#f4effe; --p-line:#e3d6fb;
    --ok:#059669; --ok-soft:#ecfdf5;
    --warn:#b45309; --warn-soft:#fffbeb;
    --stop:#be123c; --stop-soft:#fff1f2;
    --r:22px;
    --shadow:0 1px 2px rgba(11,17,32,.04), 0 12px 32px -12px rgba(11,17,32,.14);
    --shadow-lg:0 1px 2px rgba(11,17,32,.05), 0 30px 60px -24px rgba(124,58,237,.28);
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{
    margin:0; background:var(--bg); color:var(--fg); overflow-x:hidden;
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    font-feature-settings:"cv11","ss01"; -webkit-font-smoothing:antialiased;
  }
  h1,h2,h3{margin:0; letter-spacing:-.03em; line-height:1.02; text-wrap:balance}
  p{margin:0; text-wrap:pretty}
  a{color:inherit; text-decoration:none}
  button{font:inherit; color:inherit; cursor:pointer; -webkit-tap-highlight-color:transparent}
  .wrap{max-width:1120px; margin:0 auto; padding:0 20px}
  .eyebrow{
    display:inline-flex; align-items:center; gap:8px; padding:7px 14px; border-radius:999px;
    background:var(--p-soft); border:1px solid var(--p-line); color:var(--p);
    font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.18em;
  }
  .lede{color:var(--muted); font-size:17px; line-height:1.6}
  .kicker{font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.2em; color:var(--muted)}

  /* ── motion: content is visible by default; animation only enhances ─────── */
  .rise{animation:rise .7s cubic-bezier(.16,1,.3,1) both}
  .d1{animation-delay:.05s}.d2{animation-delay:.12s}.d3{animation-delay:.19s}.d4{animation-delay:.26s}
  @keyframes rise{from{opacity:0; transform:translateY(14px)} to{opacity:1; transform:none}}
  .reveal{opacity:0; transform:translateY(20px); transition:opacity .7s cubic-bezier(.16,1,.3,1), transform .7s cubic-bezier(.16,1,.3,1)}
  .reveal.in{opacity:1; transform:none}
  /* Someone who has asked their phone to stop moving things gets a page that
     does not move. Everything, not just the entrance animations. */
  @media (prefers-reduced-motion:reduce){
    *,*::before,*::after{
      animation-duration:.001ms!important; animation-iteration-count:1!important;
      transition-duration:.001ms!important; scroll-behavior:auto!important;
    }
    .rise,.reveal{animation:none!important; transition:none!important; opacity:1!important; transform:none!important}
  }
  /* if JS never runs, nothing stays hidden */
  html.no-js .reveal{opacity:1; transform:none}

  /* ── header ─────────────────────────────────────────────────────────────── */
  header{position:sticky; top:0; z-index:60; background:rgba(255,255,255,.86); backdrop-filter:blur(14px); border-bottom:1px solid var(--line)}
  .bar{display:flex; align-items:center; justify-content:space-between; gap:12px; height:66px}
  .brand{display:flex; align-items:center; gap:10px; padding:11px 0; font-weight:900; letter-spacing:-.05em; font-size:19px}
  .dot{width:26px; height:26px; border-radius:50%; border:3px solid var(--p); position:relative; flex:0 0 auto}
  .dot:after{content:""; position:absolute; inset:5px; border-radius:50%; border:3px solid var(--p); border-left-color:transparent; border-bottom-color:transparent}
  .btn{
    display:inline-flex; align-items:center; justify-content:center; gap:8px;
    border-radius:14px; border:2px solid transparent; padding:0 20px; min-height:46px;
    font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:.12em;
    background:var(--p); color:#fff; transition:transform .18s ease, box-shadow .18s ease, background .18s;
    box-shadow:0 10px 24px -10px rgba(124,58,237,.6);
  }
  .btn:hover{transform:translateY(-2px)}
  .btn.ghost{background:#fff; color:var(--fg); border-color:var(--line); box-shadow:none}
  .btn.ghost:hover{border-color:var(--p); color:var(--p)}
  .btn.lg{min-height:58px; font-size:14px; border-radius:18px; padding:0 30px}

  /* ── hero ───────────────────────────────────────────────────────────────── */
  .hero{position:relative; padding:56px 0 40px; overflow:hidden}
  .glow{position:absolute; inset:0; pointer-events:none; z-index:-1}
  .glow i{position:absolute; border-radius:50%; filter:blur(90px); display:block}
  .glow i:nth-child(1){width:60%; height:60%; left:-18%; top:-24%; background:rgba(124,58,237,.13)}
  .glow i:nth-child(2){width:52%; height:52%; right:-16%; top:6%; background:rgba(56,189,248,.11)}
  .hero-grid{display:grid; gap:38px; align-items:center}
  @media(min-width:1000px){ .hero-grid{grid-template-columns:1.02fr .98fr; gap:52px} .hero{padding:76px 0 56px} }
  h1{font-size:clamp(2.3rem,7.4vw,4.3rem); font-weight:900; text-transform:uppercase}
  h1 em{font-style:italic; text-transform:lowercase; letter-spacing:-.02em; color:var(--p); font-family:Georgia,"Times New Roman",serif; font-weight:400}
  .ticks{display:flex; flex-wrap:wrap; gap:8px 18px; font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.13em; color:var(--muted)}
  .ticks span{display:inline-flex; align-items:center; gap:6px}
  .ticks b{color:var(--p)}
  .cta-row{display:flex; flex-direction:column; gap:10px}
  @media(min-width:520px){ .cta-row{flex-direction:row} }

  /* ── segment switch ─────────────────────────────────────────────────────── */
  .seg{background:var(--soft); border:1px solid var(--line); border-radius:20px; padding:14px}
  .seg-label{font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.16em; color:var(--muted); margin-bottom:10px; display:block}
  .seg-btns{display:grid; grid-template-columns:1fr 1fr; gap:8px}
  @media(min-width:760px){ .seg-btns{grid-template-columns:repeat(4,1fr)} }
  .seg-btns button{
    border:2px solid var(--line); background:#fff; border-radius:14px; min-height:60px; padding:8px 10px;
    font-size:11.5px; font-weight:900; text-transform:uppercase; letter-spacing:.06em; line-height:1.25;
    transition:border-color .2s, background .2s, transform .2s, color .2s;
  }
  .seg-btns button:hover{border-color:var(--p-line)}
  .seg-btns button[aria-pressed="true"]{border-color:var(--p); background:var(--p-soft); color:var(--p); transform:translateY(-2px)}
  .seg-out{margin-top:14px; background:#fff; border:1px solid var(--line); border-radius:16px; padding:16px}
  .seg-out h3{font-size:16px; font-weight:900; text-transform:uppercase; margin-bottom:8px}
  .seg-out p{font-size:14px; color:var(--muted); line-height:1.6}
  .seg-out ul{margin:12px 0 0; padding:0; list-style:none; display:grid; gap:8px}
  .seg-out li{display:flex; gap:9px; font-size:12.5px; font-weight:700; color:var(--muted); align-items:flex-start}
  .seg-out li:before{content:"✓"; color:var(--p); font-weight:900; flex:0 0 auto}
  .seg-price{margin-top:14px; padding-top:14px; border-top:1px solid var(--line); display:flex; align-items:baseline; gap:8px; flex-wrap:wrap}
  .seg-price b{font-size:34px; font-weight:900; letter-spacing:-.04em; font-variant-numeric:tabular-nums}
  .seg-price span{font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.14em; color:var(--muted)}
  .seg-price .free{color:var(--p)}

  /* ── sections ───────────────────────────────────────────────────────────── */
  section{padding:64px 0}
  .band{background:var(--soft); border-top:1px solid var(--line); border-bottom:1px solid var(--line)}
  .head{max-width:660px; margin:0 auto 34px; text-align:center; display:grid; gap:14px; justify-items:center}
  .head h2{font-size:clamp(1.7rem,5vw,2.9rem); font-weight:900; text-transform:uppercase}

  /* ── the eight-check demo ───────────────────────────────────────────────── */
  .demo{display:grid; gap:18px}
  @media(min-width:960px){ .demo{grid-template-columns:1fr 1.06fr; gap:26px; align-items:start} }
  .panel{background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:18px; box-shadow:var(--shadow)}
  .panel-top{display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:14px}
  .chip{border-radius:999px; padding:5px 11px; font-size:9.5px; font-weight:900; text-transform:uppercase; letter-spacing:.14em; background:var(--p-soft); color:var(--p); white-space:nowrap}
  .slots{display:grid; grid-template-columns:repeat(3,1fr); gap:8px}
  @media(min-width:420px){ .slots{grid-template-columns:repeat(4,1fr)} }
  .slot{
    border:2px solid var(--line); background:#fff; border-radius:13px; min-height:48px; padding:6px 4px;
    font-size:13px; font-weight:900; font-variant-numeric:tabular-nums; letter-spacing:-.02em;
    transition:transform .15s, border-color .2s, background .2s, color .2s; position:relative;
  }
  .slot small{display:block; font-size:8px; font-weight:800; text-transform:uppercase; letter-spacing:.1em; opacity:.75; margin-top:2px}
  .slot.open{border-color:var(--p); color:var(--p); background:var(--p-soft)}
  .slot.shut{color:#94a3b8; background:var(--soft)}
  .slot:hover{transform:translateY(-2px)}
  .slot[aria-pressed="true"]{outline:3px solid rgba(124,58,237,.32); outline-offset:2px}
  .legend{display:flex; gap:14px; flex-wrap:wrap; margin-top:12px; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.1em; color:var(--muted)}
  .legend i{width:11px; height:11px; border-radius:4px; display:inline-block; margin-right:5px; vertical-align:-1px}

  .verdict{background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:18px; box-shadow:var(--shadow); min-height:330px}
  .verdict-head{display:flex; align-items:center; gap:10px; margin-bottom:4px}
  .badge{border-radius:999px; padding:6px 12px; font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:.14em}
  .badge.ok{background:var(--ok-soft); color:var(--ok)}
  .badge.no{background:var(--stop-soft); color:var(--stop)}
  .badge.idle{background:var(--soft); color:var(--muted)}
  .verdict h3{font-size:19px; font-weight:900; text-transform:uppercase; margin:12px 0 8px}
  .verdict .why{font-size:14.5px; color:var(--muted); line-height:1.62}
  .checks{list-style:none; margin:16px 0 0; padding:0; display:grid; gap:6px}
  .checks li{
    display:flex; align-items:center; gap:10px; padding:9px 11px; border-radius:12px; background:var(--soft);
    font-size:12px; font-weight:700; color:var(--muted);
    opacity:0; transform:translateX(-8px); animation:slide .34s cubic-bezier(.16,1,.3,1) both;
  }
  @keyframes slide{to{opacity:1; transform:none}}
  .checks li .mk{width:20px; height:20px; border-radius:7px; display:grid; place-items:center; font-size:11px; font-weight:900; flex:0 0 auto; color:#fff; background:var(--ok)}
  .checks li.bad{background:var(--stop-soft); color:var(--stop)}
  .checks li.bad .mk{background:var(--stop)}
  .checks li.skip{opacity:.45}
  .checks li.skip .mk{background:#cbd5e1}
  @media (prefers-reduced-motion:reduce){ .checks li{animation:none; opacity:1; transform:none} }
  .hint{margin-top:14px; font-size:11.5px; font-weight:800; text-transform:uppercase; letter-spacing:.1em; color:var(--p)}

  /* ── calculator ─────────────────────────────────────────────────────────── */
  .calc{display:grid; gap:18px}
  @media(min-width:900px){ .calc{grid-template-columns:1fr 1fr; gap:26px; align-items:start} }
  .field{margin-bottom:20px}
  .field label{display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:9px}
  .field .nm{font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:.14em; color:var(--muted)}
  .field .vl{font-size:22px; font-weight:900; letter-spacing:-.03em; font-variant-numeric:tabular-nums; color:var(--p)}
  input[type=range]{-webkit-appearance:none; appearance:none; width:100%; height:34px; background:transparent; display:block}
  input[type=range]::-webkit-slider-runnable-track{height:8px; border-radius:99px; background:var(--line)}
  input[type=range]::-webkit-slider-thumb{-webkit-appearance:none; width:30px; height:30px; border-radius:50%; background:var(--p); border:4px solid #fff; box-shadow:0 4px 14px -2px rgba(124,58,237,.65); margin-top:-11px}
  input[type=range]::-moz-range-track{height:8px; border-radius:99px; background:var(--line)}
  input[type=range]::-moz-range-thumb{width:22px; height:22px; border:4px solid #fff; border-radius:50%; background:var(--p)}
  .out{background:var(--fg); color:#fff; border-radius:var(--r); padding:22px; box-shadow:var(--shadow-lg)}
  .out .kicker{color:rgba(255,255,255,.55)}
  .big{font-size:clamp(2.4rem,9vw,3.4rem); font-weight:900; letter-spacing:-.045em; font-variant-numeric:tabular-nums; margin:6px 0 2px; line-height:1}
  .out .sub{font-size:13px; color:rgba(255,255,255,.62); line-height:1.55}
  .rows{margin-top:18px; border-top:1px solid rgba(255,255,255,.14); padding-top:14px; display:grid; gap:11px}
  .row{display:flex; align-items:baseline; justify-content:space-between; gap:12px; font-size:12.5px}
  .row span{color:rgba(255,255,255,.6); font-weight:700}
  .row b{font-weight:900; font-variant-numeric:tabular-nums; font-size:15px}
  .row.tot{border-top:1px solid rgba(255,255,255,.14); padding-top:12px}
  .row.tot span{color:#fff}
  .row.tot b{color:#a78bfa}

  /* ── tour ───────────────────────────────────────────────────────────────── */
  /* Wrap rather than scroll. A hidden-scrollbar tab strip on a 390px phone
     leaves the fourth tab off-screen with nothing to tell you it is there. */
  .tabs{display:flex; flex-wrap:wrap; gap:8px; padding-bottom:4px}
  .tabs::-webkit-scrollbar{display:none}
  .tabs button{
    flex:0 0 auto; border:2px solid var(--line); background:#fff; border-radius:999px; min-height:46px; padding:0 18px;
    font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:.1em; white-space:nowrap; transition:.2s;
  }
  .tabs button[aria-selected="true"]{background:var(--fg); color:#fff; border-color:var(--fg)}
  .stage{margin-top:16px; background:var(--card); border:1px solid var(--line); border-radius:var(--r); padding:18px; box-shadow:var(--shadow)}
  .stage h3{font-size:17px; font-weight:900; text-transform:uppercase; margin-bottom:8px}
  .stage p{font-size:14px; color:var(--muted); line-height:1.62}
  .mock{margin-top:16px; display:grid; gap:7px}
  .mrow{display:flex; align-items:center; gap:11px; border:1px solid var(--line); border-radius:14px; padding:11px 12px; background:var(--soft); animation:rise .45s cubic-bezier(.16,1,.3,1) both}
  .mrow .t{width:48px; flex:0 0 auto; text-align:right; font-size:11px; font-weight:900; font-variant-numeric:tabular-nums; color:var(--muted)}
  .mrow .m{flex:1 1 auto; min-width:0}
  .mrow .m b{display:block; font-size:12.5px; font-weight:900; text-transform:uppercase; letter-spacing:-.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
  .mrow .m i{display:block; font-style:normal; font-size:11.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
  .tg{flex:0 0 auto; border-radius:999px; padding:4px 9px; font-size:8.5px; font-weight:900; text-transform:uppercase; letter-spacing:.1em}
  .tg.g{background:var(--ok-soft); color:var(--ok)} .tg.p{background:var(--p-soft); color:var(--p)}
  .tg.a{background:var(--warn-soft); color:var(--warn)} .tg.n{background:#eef2f7; color:var(--muted)}

  footer{border-top:1px solid var(--line); background:var(--soft); padding:34px 0}
  .fnote{font-size:11.5px; color:var(--muted); line-height:1.6; margin-top:16px}
  .plabel{display:inline-block; margin-top:8px; font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:.14em; color:var(--p)}
</style>
</head>
<body>
<script>document.documentElement.classList.remove('no-js')</script>

<header>
  <div class="wrap bar">
    <a class="brand" href="#top"><span class="dot"></span>ClarityFlow</a>
    <a class="btn" href="#try" style="min-height:44px;padding:0 16px">Try the demo</a>
  </div>
</header>

<main id="top">

  <!-- ══ HERO ══════════════════════════════════════════════════════════════ -->
  <section class="hero">
    <div class="glow" aria-hidden="true"><i></i><i></i></div>
    <div class="wrap hero-grid">
      <div style="display:grid; gap:22px">
        <span class="eyebrow rise d1">You outgrew your booking app</span>
        <h1 class="rise d2">The system a studio runs on when <em>some chairs are rented</em> and some aren't.</h1>
        <p class="lede rise d3">Every other salon tool makes you pick one — employees on commission, or booth renters — and fake the other in a spreadsheet. ClarityFlow runs both at once, on one calendar, with one set of books.</p>
        <div class="cta-row rise d4">
          <a class="btn lg" href="#try">Try it right here →</a>
          <a class="btn lg ghost" href="#worth">What it's worth</a>
        </div>
        <div class="ticks rise d4">
          <span><b>✓</b> Free in early access</span>
          <span><b>✓</b> No card</span>
          <span><b>✓</b> Live in an afternoon</span>
        </div>
      </div>

      <!-- studio-type selector -->
      <div class="seg rise d3">
        <span class="seg-label">Which one are you?</span>
        <div class="seg-btns" id="segBtns" role="group" aria-label="Studio type"></div>
        <div class="seg-out" id="segOut" aria-live="polite"></div>
      </div>
    </div>
  </section>

  <!-- ══ THE EIGHT-CHECK DEMO ══════════════════════════════════════════════ -->
  <section class="band" id="try">
    <div class="wrap">
      <div class="head reveal">
        <span class="eyebrow">Show and tell · not a screenshot</span>
        <h2>Tap a grey time. It tells you exactly why it's closed.</h2>
        <p class="lede">This is the real scheduling engine's logic, running in your browser. Most booking tools check working hours and existing appointments — two things. Watch what happens when a system checks all eight.</p>
      </div>

      <div class="demo">
        <div class="panel reveal">
          <div class="panel-top">
            <div>
              <p class="kicker">Tuesday · 3 stations</p>
              <p style="font-size:19px;font-weight:900;text-transform:uppercase;letter-spacing:-.03em">Gel manicure · 75 min</p>
            </div>
            <span class="chip">Any pro</span>
          </div>
          <div class="slots" id="slots" role="group" aria-label="Available times"></div>
          <div class="legend">
            <span><i style="background:var(--p-soft);border:2px solid var(--p)"></i>Bookable</span>
            <span><i style="background:var(--soft);border:2px solid var(--line)"></i>Closed — tap to see why</span>
          </div>
          <p class="hint" id="hint">↑ Tap any time, including the grey ones</p>
        </div>

        <div class="verdict reveal" id="verdict"></div>
      </div>
    </div>
  </section>

  <!-- ══ CALCULATOR ════════════════════════════════════════════════════════ -->
  <section id="worth">
    <div class="wrap">
      <div class="head reveal">
        <span class="eyebrow">What it's worth</span>
        <h2>The money is already leaving. Move the sliders.</h2>
        <p class="lede">These are the four leaks ClarityFlow plugs. Nothing here is a feature list — it's arithmetic on your own numbers.</p>
      </div>

      <div class="calc">
        <div class="panel reveal">
          <div class="field">
            <label for="chairs"><span class="nm">Chairs in your studio</span><span class="vl" id="vChairs">6</span></label>
            <input type="range" id="chairs" min="1" max="16" step="1" value="6">
          </div>
          <div class="field">
            <label for="rented"><span class="nm">Of those, chairs you rent out</span><span class="vl" id="vRented">3</span></label>
            <input type="range" id="rented" min="0" max="16" step="1" value="3">
          </div>
          <div class="field">
            <label for="ticket"><span class="nm">Average ticket</span><span class="vl" id="vTicket">$85</span></label>
            <input type="range" id="ticket" min="25" max="300" step="5" value="85">
          </div>
          <div class="field" style="margin-bottom:0">
            <label for="rent"><span class="nm">Monthly rent per chair</span><span class="vl" id="vRent">$900</span></label>
            <input type="range" id="rent" min="200" max="2000" step="50" value="900">
          </div>
        </div>

        <div class="out reveal">
          <p class="kicker">Leaking out of the studio each month</p>
          <p class="big" id="total">$0</p>
          <p class="sub" id="totalSub"></p>
          <div class="rows">
            <div class="row"><span>No-shows with no deposit held</span><b id="rNoShow">$0</b></div>
            <div class="row"><span>Rent collected late or not at all</span><b id="rRent">$0</b></div>
            <div class="row"><span>Empty chair-hours nobody filled</span><b id="rGap">$0</b></div>
            <div class="row"><span>Your hours on admin, at $45/hr</span><b id="rAdmin">$0</b></div>
            <div class="row tot"><span>ClarityFlow, this studio</span><b id="rPrice">$0 / mo</b></div>
          </div>
          <p class="sub" style="margin-top:14px" id="ratio"></p>
        </div>
      </div>
      <p class="fnote reveal">Assumes an 8% no-show rate, 6% of rent landing late, and four hours a week of owner admin — the middle of what studio owners report. Every number here is an estimate you can argue with; that's the point of the sliders.</p>
    </div>
  </section>

  <!-- ══ TOUR ══════════════════════════════════════════════════════════════ -->
  <section class="band">
    <div class="wrap">
      <div class="head reveal">
        <span class="eyebrow">The rest of it</span>
        <h2>Four screens you'll live in</h2>
      </div>
      <div class="reveal">
        <div class="tabs" id="tabs" role="tablist"></div>
        <div class="stage" id="stage"></div>
      </div>
    </div>
  </section>

  <!-- ══ CLOSE ═════════════════════════════════════════════════════════════ -->
  <section>
    <div class="wrap head reveal" style="margin-bottom:0">
      <h2>Start with the booking page. Today.</h2>
      <p class="lede">It takes an afternoon, it costs nothing while we're in early access, and it's the part that pays for itself first.</p>
      <a class="btn lg" href="#top" style="margin-top:8px">Start free</a>
      <span class="plabel">No card · no contract</span>
    </div>
  </section>
</main>

<footer>
  <div class="wrap">
    <a class="brand" href="#top"><span class="dot"></span>ClarityFlow</a>
    <p class="fnote"><b>Prototype.</b> This page exists so you can feel the interaction model — the studio-type switch, the tap-to-see-why scheduler, and the money slider. Copy, prices and styling are all still up for argument. Nothing here talks to a live account.</p>
  </div>
</footer>

<script>
(function(){
  "use strict";
  var $ = function(id){ return document.getElementById(id); };
  var money = function(n){ return '$' + Math.round(n).toLocaleString('en-US'); };

  /* ── 1. studio-type selector ─────────────────────────────────────────── */
  var SEGS = [
    { key:'solo', label:'Just me,<br>one chair', title:'Solo — one chair, everything on it',
      body:'You are the front desk, the tech and the bookkeeper. The win here is that the booking page, the deposit, the consent form and the reminder all happen without you touching your phone.',
      feats:['Public booking page with deposits','Text + email reminders, automatic','Consent forms with e-signature','Checkout with tips and retail','Client history and photos'],
      price:39 },
    { key:'team', label:'A team on<br>commission', title:'Studio — a team, one schedule',
      body:'The moment there are three of you, the fights are about who got the walk-in and whether the schedule is right. Fair turn rotation and one shared availability engine end both.',
      feats:['Everything in Solo, unlimited staff','Fair turn rotation for walk-ins','Timeclock and staff portal','Payroll draft, Gusto export','Bank feed, bills and reporting'],
      price:149 },
    { key:'booth', label:'I rent<br>chairs out', title:'Booths — you are a landlord too',
      body:'Rent is a second business with its own paperwork, and a spreadsheet is not it. Signed agreements, card on file, rent charged on schedule, and a portal so renters stop texting you.',
      feats:['Renters, agreements and e-signature','Card on file, rent on schedule','Late-rent tracking, automatic','Short-term chair stays and tours','Renter portal + maintenance log'],
      price:249 },
    { key:'both', label:'Both —<br>and it\'s messy', title:'Both — and this is the one nobody else does',
      body:'Half your chairs are employees on commission, half are renters paying you. Every other platform makes you pick one and fake the other. Here they share one calendar and one set of books, and the money still adds up.',
      feats:['Everything in Studio and Booths','One calendar, two business models','Commission and rent side by side','Reporting that separates the two','Convert a stylist either direction'],
      price:249 }
  ];
  var segBtns = $('segBtns'), segOut = $('segOut');
  if (segBtns && segOut) {
    SEGS.forEach(function(s, i){
      var b = document.createElement('button');
      b.type = 'button'; b.innerHTML = s.label;
      b.setAttribute('aria-pressed', i === 3 ? 'true' : 'false');
      b.addEventListener('click', function(){ pickSeg(i); });
      segBtns.appendChild(b);
    });
    function pickSeg(i){
      var s = SEGS[i];
      Array.prototype.forEach.call(segBtns.children, function(el, j){
        el.setAttribute('aria-pressed', j === i ? 'true' : 'false');
      });
      segOut.innerHTML =
        '<h3>' + s.title + '</h3>' +
        '<p>' + s.body + '</p>' +
        '<ul>' + s.feats.map(function(f){ return '<li>' + f + '</li>'; }).join('') + '</ul>' +
        '<div class="seg-price"><b>' + money(s.price) + '</b><span>/ month planned</span>' +
        '<span class="free">· free right now</span></div>';
      segOut.style.animation = 'none';
      void segOut.offsetWidth;
      segOut.style.animation = 'rise .45s cubic-bezier(.16,1,.3,1) both';
    }
    pickSeg(3);
  }

  /* ── 2. the eight-check scheduler ────────────────────────────────────── */
  // Eight ordered checks, mirroring what the real engine evaluates.
  var CHECKS = [
    'Studio hours',
    'Published shift roster',
    'Approved time off',
    "Staff member's own week",
    'Existing appointments',
    'Cleanup padding',
    'Station capacity',
    'Equipment out of service'
  ];
  // failAt = index of the first check that fails; -1 means every check passes.
  var SLOTS = [
    { t:'9:00',  failAt:4, pro:'Dana',   head:'Dana is mid-service',
      why:'Dana is 20 minutes into a full set with Elena and does not finish until 10:00. The chair is warm and the hands are busy.' },
    { t:'9:30',  failAt:5, pro:'Dana',   head:'Turnaround time',
      why:'Elena finishes at 10:00 and the station needs 10 minutes to be wiped, re-laid and ready. Booking here means your next guest sits down at a dirty station — so the engine will not offer it.' },
    { t:'10:00', failAt:-1, pro:'Dana',  head:'Open — Dana',
      why:'All eight checks clear. Dana is rostered, on shift, free, the station is ready and there is room before her next guest. A deposit would be taken at this point and the slot closed to everyone else instantly.' },
    { t:'11:00', failAt:1,  pro:'—',     head:'Nobody rostered',
      why:'Two techs can do a gel manicure, and neither is on this week\'s published shift at 11:00. Their profile says they *can* work Tuesdays — the roster says they aren\'t, this Tuesday. Most tools only read the profile and cheerfully book you into an empty salon.' },
    { t:'12:00', failAt:2,  pro:'Priya',  head:'Approved day off',
      why:'Priya requested today off and you approved it on Monday. That approval is now a fact the booking page respects, not a note in a group chat. Nobody has to remember.' },
    { t:'1:00',  failAt:6,  pro:'—',      head:'All three chairs full',
      why:'Two techs are free at 1:00, and it still cannot be booked: all three stations are occupied. This is a capacity problem, not a calendar problem, and it is the one almost no booking tool models. A time you can staff but cannot seat is not a time.' },
    { t:'2:00',  failAt:7,  pro:'—',      head:'Station out of service',
      why:'Station 2 has an open urgent maintenance ticket — the lamp failed Saturday. Until someone closes that ticket the station is not bookable, so your capacity is two, not three.' },
    { t:'3:00',  failAt:-1, pro:'Marcus', head:'Open — Marcus',
      why:'Everything clears. Note who you got: Marcus, because turn rotation says he is next up — not because he happens to be first in a list. That single detail is worth real money to whoever was getting skipped.' },
    { t:'4:00',  failAt:3,  pro:'Marcus', head:'Personal hold',
      why:'Marcus blocked 4:00 to 5:30 for a colour-correction consult he booked himself. Staff can hold their own time without asking you, and the public page honours it immediately.' },
    { t:'5:00',  failAt:-1, pro:'Dana',   head:'Open — Dana',
      why:'Clear, and just barely: 75 minutes from 5:00 lands at 6:15, and you close at 6:30. Fifteen minutes of margin is enough, so it is offered.' },
    { t:'5:30',  failAt:0,  pro:'—',      head:'Runs past closing',
      why:'A 75-minute service starting at 5:30 ends at 6:45 and you close at 6:30. The service length decides this, not the clock — a 30-minute polish change would still be offered here.' },
    { t:'6:00',  failAt:0,  pro:'—',      head:'Closed',
      why:'You are closed. Worth saying out loud because plenty of booking pages will happily take a 6:00 request and leave you to phone the client back and apologise.' }
  ];

  var slotsEl = $('slots'), verdictEl = $('verdict'), hintEl = $('hint');

  function renderVerdict(s){
    if (!s) {
      verdictEl.innerHTML =
        '<div class="verdict-head"><span class="badge idle">Waiting</span></div>' +
        '<h3>Pick a time</h3>' +
        '<p class="why">Every time you tap runs the same eight checks the server runs when a real guest presses Book. That is the whole trick: the page that shows you a time and the code that accepts the booking are the same code, so a slot on screen is a slot you can honour.</p>' +
        '<ul class="checks">' + CHECKS.map(function(c, i){
          return '<li class="skip" style="animation-delay:' + (i * 0.05) + 's"><span class="mk">·</span>' + c + '</li>';
        }).join('') + '</ul>';
      return;
    }
    var ok = s.failAt === -1;
    var items = CHECKS.map(function(c, i){
      var cls = 'skip', mk = '·';
      if (ok || i < s.failAt) { cls = ''; mk = '✓'; }
      else if (i === s.failAt) { cls = 'bad'; mk = '✕'; }
      return '<li class="' + cls + '" style="animation-delay:' + (i * 0.055) + 's"><span class="mk">' + mk + '</span>' + c + '</li>';
    }).join('');
    verdictEl.innerHTML =
      '<div class="verdict-head">' +
        '<span class="badge ' + (ok ? 'ok' : 'no') + '">' + (ok ? 'Bookable' : 'Not bookable') + '</span>' +
        '<span class="chip">' + s.t + (s.pro !== '—' ? ' · ' + s.pro : '') + '</span>' +
      '</div>' +
      '<h3>' + s.head + '</h3>' +
      '<p class="why">' + s.why + '</p>' +
      '<ul class="checks">' + items + '</ul>';
  }

  if (slotsEl && verdictEl) {
    SLOTS.forEach(function(s, i){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot ' + (s.failAt === -1 ? 'open' : 'shut');
      b.innerHTML = s.t + '<small>' + (s.failAt === -1 ? 'Open' : 'Closed') + '</small>';
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function(){
        Array.prototype.forEach.call(slotsEl.children, function(el){ el.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        renderVerdict(s);
        if (hintEl) hintEl.textContent = 'Keep tapping — each grey time fails a different check';
      });
      slotsEl.appendChild(b);
    });
    renderVerdict(null);
  }

  /* ── 3. money calculator ─────────────────────────────────────────────── */
  var ids = ['chairs','rented','ticket','rent'];
  function calc(){
    var chairs = +$('chairs').value;
    var rented = Math.min(+$('rented').value, chairs);
    var ticket = +$('ticket').value;
    var rent   = +$('rent').value;

    $('vChairs').textContent = chairs;
    $('vRented').textContent = rented;
    $('vTicket').textContent = money(ticket);
    $('vRent').textContent   = money(rent);
    if (+$('rented').value > chairs) $('rented').value = chairs;

    var working = chairs - rented;                 // chairs you earn service revenue on
    var visitsPerChair = 5 * 5;                    // ~25 guests / chair / month, conservative
    var noShow = working * visitsPerChair * ticket * 0.08;
    var lateRent = rented * rent * 0.06;
    var gap = working * ticket * 2.2;              // ~2 unfilled chair-hours a month per chair
    var admin = 4 * 4.33 * 45;                     // 4 hrs/week of owner admin at $45/hr

    var total = noShow + lateRent + gap + admin;
    var price = rented > 0 ? 249 : (chairs > 1 ? 149 : 39);

    $('rNoShow').textContent = money(noShow);
    $('rRent').textContent   = money(lateRent);
    $('rGap').textContent    = money(gap);
    $('rAdmin').textContent  = money(admin);
    $('rPrice').textContent  = money(price) + ' / mo';
    $('total').textContent   = money(total);
    $('totalSub').textContent = chairs + ' chair' + (chairs === 1 ? '' : 's') +
      (rented > 0 ? ', ' + rented + ' rented out' : ', all worked in-house') + '.';
    $('ratio').textContent = 'That is ' + Math.max(1, Math.round(total / price)) +
      '× the monthly price of the software meant to stop it — and every plan is free while we are in early access.';
  }
  ids.forEach(function(id){
    var el = $(id);
    if (el) { el.addEventListener('input', calc); el.addEventListener('change', calc); }
  });
  if ($('chairs')) calc();

  /* ── 4. product tour ─────────────────────────────────────────────────── */
  var TOUR = [
    { tab:'Today', h:'The day, in one screen',
      p:'Who is in, what is paid, what still needs a deposit, and which station is down. The screen you leave open on the front desk.',
      rows:[['9:00','Dana R.','Gel manicure','Deposit paid','g'],['10:30','Priya S.','Full set + art','Confirmed','g'],
            ['12:00','—','Cleanup + lunch','Blocked','n'],['1:00','Marcus T.','Pedicure','Reminded','g'],
            ['2:30','Open','Any available','Bookable','p']] },
    { tab:'Booth rent', h:'Rent, without the chase',
      p:'Card on file, charged on schedule, agreements signed and filed. Late rent flags itself instead of waiting for you to notice.',
      rows:[['Ch 1','Nadia K.','$900 · monthly','Charged','g'],['Ch 2','Tomas R.','$900 · monthly','Charged','g'],
            ['Ch 3','Bree L.','$850 · monthly','3 days late','a'],['Ch 4','—','Short-term stay','2 tours booked','p']] },
    { tab:'Payroll', h:'The math, already done',
      p:'Timeclock in, commission or rent-based out, a draft ready to hand to Gusto. You approve rather than calculate.',
      rows:[['Dana','Commission 45%','$2,140 + $310 tips','Draft ready','g'],['Marcus','Hourly + tips','$1,480 + $265 tips','Draft ready','g'],
            ['Nadia','Booth renter','Rent paid · no payroll','Excluded','n'],['—','Period','Jul 1 – Jul 15','Awaiting you','p']] },
    { tab:'Money', h:'One number answers',
      p:'Checkout, retail, tips, the bank feed and recurring bills land in the same ledger, so “what did I make” has one answer.',
      rows:[['Services','—','1,284 visits','$96,300','g'],['Retail','—','212 items','$7,410','g'],
            ['Booth rent','—','4 chairs','$3,550','g'],['Net','—','After bills','$41,880','p']] }
  ];
  var tabsEl = $('tabs'), stageEl = $('stage');
  if (tabsEl && stageEl) {
    TOUR.forEach(function(t, i){
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = t.tab; b.setAttribute('role','tab');
      b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      b.addEventListener('click', function(){ pickTab(i); });
      tabsEl.appendChild(b);
    });
    function pickTab(i){
      var t = TOUR[i];
      Array.prototype.forEach.call(tabsEl.children, function(el, j){
        el.setAttribute('aria-selected', j === i ? 'true' : 'false');
      });
      stageEl.innerHTML = '<h3>' + t.h + '</h3><p>' + t.p + '</p><div class="mock">' +
        t.rows.map(function(r, k){
          return '<div class="mrow" style="animation-delay:' + (k * 0.06) + 's">' +
            '<span class="t">' + r[0] + '</span>' +
            '<span class="m"><b>' + r[1] + '</b><i>' + r[2] + '</i></span>' +
            '<span class="tg ' + r[4] + '">' + r[3] + '</span></div>';
        }).join('') + '</div>';
    }
    pickTab(0);
  }

  /* ── 5. scroll reveal (enhancement only — content is never gated) ─────── */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    Array.prototype.forEach.call(reveals, function(el){ io.observe(el); });
  } else {
    Array.prototype.forEach.call(reveals, function(el){ el.classList.add('in'); });
  }
})();
</script>
</body>
</html>
