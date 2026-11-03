// src/components/booking/flow-css.ts — THE BOOKING SHEET'S OWN LOOK (cf- classes), shared by the sheet (StudioFlow) and
// the visit link's forms (VisitForms), so a form looks the same wherever it's filled in. Sits on top of the public
// kit's look (PUBLIC_CSS, inside .pub). Every color is the mood's (paper, card, ink, muted, line), so Soft, Crisp and
// Night all follow; Crisp tightens the corners. 44px or more for everything tapped.
export const FLOW_CSS = String.raw`
.cf-root{position:fixed;inset:0;z-index:100;display:flex;align-items:flex-end;justify-content:center;background:transparent!important}
.cf-scrim{position:absolute;inset:0;background:rgba(28,25,23,.34);touch-action:none}
.cf-grab,.cf-head,.cf-prog,.cf-bar{touch-action:none}
.pub[data-mood=night] .cf-scrim{background:rgba(0,0,0,.62)}
.cf-panel{position:relative;display:flex;flex-direction:column;width:100%;height:calc(100% - env(safe-area-inset-top,0px) - 40px);background:var(--paper);color:var(--ink);border-radius:28px 28px 0 0;overflow:hidden;box-shadow:0 -16px 48px -24px rgba(0,0,0,.4);transition:height .38s cubic-bezier(.32,.72,0,1),border-radius .38s}
.cf-panel.is-done{height:100%;border-radius:0}
@media (min-width:640px){.cf-root{align-items:center;padding:24px}.cf-panel,.cf-panel.is-done{max-width:520px;height:min(880px,100%);border-radius:28px;box-shadow:0 30px 80px -30px rgba(0,0,0,.5)}}
.pub[data-mood=crisp] .cf-panel{border-radius:16px 16px 0 0}.pub[data-mood=crisp] .cf-panel.is-done{border-radius:0}
@media (min-width:640px){.pub[data-mood=crisp] .cf-panel,.pub[data-mood=crisp] .cf-panel.is-done{border-radius:16px}}
.pub[data-mood=night] .cf-panel{box-shadow:inset 0 0 0 1px rgba(255,255,255,.07),0 -16px 48px -24px rgba(0,0,0,.6)}
.cf-grab{flex:none;width:38px;height:5px;border-radius:9px;background:var(--line);margin:8px auto 0}
@media (min-width:640px){.cf-grab{display:none}}
.cf-head{flex:none;display:flex;align-items:center;gap:6px;padding:4px 6px 0}
@media (min-width:640px){.cf-head{padding-top:10px}}
.cf-bar{flex:none;display:flex;align-items:center;gap:10px;min-height:58px;padding:0 6px 0 16px;border-bottom:1px solid var(--line)}
@media (max-width:639px){.cf-panel.is-done .cf-bar{padding-top:env(safe-area-inset-top,0px)}}
.cf-mark{width:36px;height:36px;border-radius:11px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700;font-size:16px;flex:none}
.pub[data-mood=crisp] .cf-mark{border-radius:8px}
.cf-round{width:44px;height:44px;flex:none;display:grid;place-items:center;border-radius:999px;color:var(--ink)}
.cf-round>span{width:36px;height:36px;border-radius:999px;display:grid;place-items:center;background:rgba(127,127,127,.14);background:color-mix(in srgb,var(--ink) 7%,transparent);transition:background .2s}
.cf-round:active>span{background:color-mix(in srgb,var(--ink) 14%,transparent)}
.cf-round:disabled{opacity:.3}
.cf-prog{flex:none;display:flex;gap:5px;padding:10px 16px 0}
.cf-prog>span{flex:1;height:3px;border-radius:9px;background:var(--line);transition:background .45s}
.cf-prog>span.is-on{background:var(--accent-text,var(--accent))}
.cf-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:18px 16px 28px}
.cf-foot{position:relative;flex:none;padding:12px 16px calc(14px + env(safe-area-inset-bottom,0px));background:var(--paper)}
.cf-foot::before{content:'';position:absolute;left:0;right:0;bottom:100%;height:28px;background:linear-gradient(to bottom,transparent,var(--paper));pointer-events:none}
@keyframes cfIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:none}}
@keyframes cfInBack{from{opacity:0;transform:translateX(-16px)}to{opacity:1;transform:none}}
.cf-step{animation:cfIn .36s cubic-bezier(.2,.8,.2,1) both}.cf-step.is-back{animation-name:cfInBack}
.cf-lbl{font-size:13px;font-weight:600;color:var(--muted);padding:0 4px 8px}
.cf-grp{background:var(--card);border-radius:18px;overflow:hidden;box-shadow:0 1px 2px rgba(28,25,23,.05),0 8px 24px -18px rgba(28,25,23,.25)}
.pub[data-mood=crisp] .cf-grp{border-radius:12px;box-shadow:inset 0 0 0 1px var(--line)}
.pub[data-mood=night] .cf-grp{box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.cf-row{display:flex;align-items:center;gap:12px;min-height:52px;padding:0 16px;border-top:1px solid var(--line);color:var(--ink)}
.cf-row:first-child{border-top:0}
.cf-tap{transition:background .15s}.cf-tap:active{background:color-mix(in srgb,var(--ink) 5%,transparent)}
.cf-row:focus-within{box-shadow:inset 3px 0 0 var(--accent-text,var(--accent))}
.cf-k{width:74px;flex:none;font-size:14px;color:var(--muted)}
.cf-in{flex:1;min-width:0;height:50px;background:transparent;border:0;outline:none;font-size:16px;color:var(--ink);font-family:inherit}
.cf-in::placeholder{color:var(--muted);opacity:.75}
.pub .cf-in:focus-visible{outline:none}
.cf-area{display:block;width:100%;height:auto;min-height:92px;padding:14px 16px;resize:vertical;line-height:1.45}
.cf-field{height:48px;width:100%;border-radius:14px;border:1px solid var(--line);background:var(--card);padding:0 14px;font-size:16px;color:var(--ink)}
.cf-btn{display:flex;width:100%;height:52px;align-items:center;justify-content:center;border-radius:999px;background:var(--accent);color:#fff;font-size:16px;font-weight:600;box-shadow:0 10px 24px -14px rgba(0,0,0,.45)}
.cf-btn:disabled{opacity:.42;box-shadow:none}
.cf-btn-sm{width:auto;height:46px;padding:0 20px;font-size:15px}
.pub[data-mood=crisp] .cf-btn{border-radius:12px}
.pub[data-mood=night] .cf-btn{box-shadow:inset 0 0 0 1px rgba(255,255,255,.28)}
.cf-quiet{display:inline-flex;min-height:48px;align-items:center;justify-content:center;gap:8px;padding:0 18px;border-radius:999px;background:var(--card);color:var(--ink);font-size:15px;font-weight:500;box-shadow:0 1px 2px rgba(28,25,23,.06),inset 0 0 0 1px var(--line)}
.pub[data-mood=crisp] .cf-quiet{border-radius:12px}
.cf-link{display:inline-flex;min-height:44px;align-items:center;gap:6px;font-size:14px;font-weight:600;color:var(--accent-text,var(--accent))}
.cf-link.inline{min-height:0;display:inline;text-decoration:underline;text-underline-offset:3px}
.cf-scroll{position:relative;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-padding:0 16px}.cf-scroll::-webkit-scrollbar{display:none}
.cf-chip{display:inline-flex;flex:none;align-items:center;gap:8px;height:44px;padding:0 16px 0 7px;border-radius:999px;background:var(--card);color:var(--ink);font-size:14.5px;font-weight:500;box-shadow:0 1px 2px rgba(28,25,23,.07)}
.cf-chip-text,.cf-chip-full{padding:0 16px}.cf-chip-full{justify-content:center;width:100%}
.cf-chip:is([aria-pressed=true],[aria-checked=true]){background:var(--ink);color:var(--paper);box-shadow:none}
.cf-av{display:grid;place-items:center;border-radius:999px;font-weight:700;background:color-mix(in srgb,var(--accent) 16%,var(--card));color:var(--accent-text,var(--accent))}
.cf-chip[aria-pressed=true] .cf-av{background:rgba(255,255,255,.18);color:inherit}
.pub[data-mood=night] .cf-chip[aria-pressed=true] .cf-av{background:rgba(0,0,0,.12)}
.cf-day{flex:none;width:56px;height:66px;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--card);color:var(--ink);box-shadow:0 1px 2px rgba(28,25,23,.07);transition:opacity .2s,background .2s}
.cf-day[aria-pressed=true]{background:var(--ink);color:var(--paper);box-shadow:none}
.cf-day.is-dim:not([aria-pressed=true]){opacity:.42}
.cf-time{position:relative;height:48px;border-radius:14px;background:var(--card);color:var(--ink);font-size:15px;font-weight:500;box-shadow:0 1px 2px rgba(28,25,23,.07)}
.cf-time[aria-pressed=true]{background:var(--accent);color:#fff;box-shadow:0 8px 18px -10px rgba(0,0,0,.45)}
.pub[data-mood=night] .cf-time[aria-pressed=true]{box-shadow:inset 0 0 0 1px rgba(255,255,255,.28)}
.pub[data-mood=crisp] :is(.cf-day,.cf-time){border-radius:10px;box-shadow:inset 0 0 0 1px var(--line)}
.pub[data-mood=crisp] .cf-chip{border-radius:10px;box-shadow:inset 0 0 0 1px var(--line)}
.pub[data-mood=crisp] :is(.cf-day,.cf-chip)[aria-pressed=true],.pub[data-mood=crisp] .cf-chip[aria-checked=true],.pub[data-mood=crisp] .cf-time[aria-pressed=true]{box-shadow:none}
.pub[data-mood=night] :is(.cf-day,.cf-time,.cf-chip,.cf-quiet){box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.cf-badge{position:absolute;top:-7px;right:4px;border-radius:999px;padding:1px 6px;font-size:10px;font-weight:600;line-height:1.5}
.cf-badge-new{background:#fdf0dc;color:#8a4508}.cf-badge-pts{background:var(--good-soft);color:var(--good)}
.cf-month{border-radius:18px;background:var(--card);padding:10px 6px;box-shadow:inset 0 0 0 1px var(--line)}
.cf-mday{height:44px;min-width:44px;border-radius:12px;font-size:14.5px;color:var(--ink)}
.cf-mday[aria-pressed=true]{background:var(--ink);color:var(--paper);font-weight:600}
.cf-mday:disabled{opacity:.25}.cf-mday.is-dim:not([aria-pressed=true]){opacity:.42}
.cf-soon{display:flex;align-items:center;gap:8px;min-height:44px;font-size:14.5px;font-weight:600;color:var(--good);text-align:left}
.cf-dot{display:inline-block;width:8px;height:8px;border-radius:999px;background:var(--good);flex-shrink:0}
@keyframes cfPulse{0%,100%{opacity:1}50%{opacity:.5}}
.cf-ph{height:48px;border-radius:14px;background:rgba(127,127,127,.12);background:color-mix(in srgb,var(--ink) 6%,transparent);animation:cfPulse 1.4s ease-in-out infinite}
.cf-note{display:flex;gap:10px;padding:13px 15px;border-radius:16px;background:rgba(127,127,127,.1);background:color-mix(in srgb,var(--ink) 5%,transparent);font-size:13.5px;line-height:1.45;color:var(--muted)}
.cf-warn{background:#fdf3e7;color:#8a4508}
.pub[data-mood=night] .cf-warn{background:rgba(180,83,9,.2);color:#f5c08a}
.cf-err{font-size:13px;color:#b45309}.pub[data-mood=night] .cf-err{color:#f0b27a}
.cf-hr{height:1px;background:var(--line);margin:14px 0}
.cf-more>summary{cursor:pointer;list-style:none;min-height:44px;display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.cf-more>summary::-webkit-details-marker{display:none}
.cf-count{flex:none;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600;background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--muted)}
.cf-count.is-done{background:var(--good-soft);color:var(--good)}
.cf-sw{position:relative;flex:none;width:51px;height:31px;border-radius:99px;background:#e7e5e4;transition:background .22s}
.pub[data-mood=night] .cf-sw{background:#3a3b40}
.cf-sw>span{position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .24s cubic-bezier(.2,.8,.2,1)}
.cf-sw.is-on{background:var(--accent)}.cf-sw.is-on>span{transform:translateX(20px)}
.cf-payframe{position:relative;min-height:340px;border-radius:18px;background:#fff;overflow:hidden;box-shadow:inset 0 0 0 1px var(--line)}
.cf-paywait{position:absolute;inset:0;display:grid;place-items:center;font-size:14px;color:#6d7075}
.cf-h1{font-size:30px;line-height:1.15;letter-spacing:-.02em;font-weight:300;outline:none}.cf-h1 b{font-weight:650}
@keyframes cfPopIn{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}
@keyframes cfDraw{to{stroke-dashoffset:0}}
.cf-check{width:76px;height:76px;border-radius:50%;background:var(--good-soft);color:var(--good);display:inline-grid;place-items:center;animation:cfPopIn .5s cubic-bezier(.2,.8,.2,1) both}
.cf-check .cf-draw{stroke-dasharray:24;stroke-dashoffset:24;animation:cfDraw .55s .25s cubic-bezier(.65,0,.35,1) forwards}
.cf-tile{width:42px;height:42px;flex:none;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 12%,var(--card));color:var(--accent-text,var(--accent))}
.cf-num{display:inline-grid;place-items:center;flex:none;width:20px;height:20px;border-radius:999px;font-size:11px;font-weight:600;background:color-mix(in srgb,var(--ink) 8%,transparent)}
.cf-num.is-on{background:var(--accent);color:#fff}
@media (prefers-reduced-motion:reduce){.cf-step,.cf-check,.cf-ph{animation:none}.cf-check .cf-draw{animation:none;stroke-dashoffset:0}.cf-panel,.cf-sw,.cf-sw>span{transition:none}}
`;
