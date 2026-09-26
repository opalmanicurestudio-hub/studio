'use client';
// src/components/academy/InteractiveFrame.tsx
//
// Runs an AI-built interactive (self-contained HTML) in a SEALED frame:
//   • sandbox="allow-scripts" only — no same-origin (no access to this page,
//     the student's account, cookies or storage), no popups, no forms, no
//     navigating the page
//   • a Content-Security-Policy inside the frame blocks network access; the
//     only exception is the app's own font (Google Fonts, style + font files)
//   • the ClarityFlow style kit is built in (Plus Jakarta Sans, stone palette,
//     the school's brand colour as --cf-accent, styled controls)
//   • it reports its height (fits its content) and any PROBLEM — a script error,
//     or a blank result — so the editor can offer "✨ Fix it"
//   • games report a score with window.cfScore(0–100) — once per round, only
//     from this frame — which the lesson sends to the gradebook
//   • animations pause for people whose device asks for reduced motion

import { useEffect, useMemo, useRef, useState } from 'react';
import { KIT_CSS } from '@/lib/interactive-kit';

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob:; media-src data: blob:";
const FONT = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap';
const safeColor = (c?: string | null) => (c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#7c3aed');

export function frameDoc(html: string, frameId: string, accent?: string | null) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${FONT}"><style>${KIT_CSS}:root{--cf-accent:${safeColor(accent)}}</style>
<script>(function(){var id=${JSON.stringify(frameId)};function post(m){try{parent.postMessage(Object.assign({cfFrame:id},m),'*')}catch(e){}}
window.addEventListener('error',function(e){post({problem:String(e.message||'Script error')+(e.lineno?' (line '+e.lineno+')':'')})});
window.addEventListener('unhandledrejection',function(e){post({problem:'Unhandled error: '+String(e.reason&&e.reason.message||e.reason)})});
function size(){post({h:Math.ceil(document.documentElement.scrollHeight)})}
var scored=0;window.cfScore=function(p){var n=Math.round(Number(p));if(!(n>=0&&n<=100)||Date.now()-scored<1500)return;scored=Date.now();post({score:n})};
window.addEventListener('load',function(){size();new ResizeObserver(size).observe(document.body);setTimeout(size,300);
  setTimeout(function(){var r=document.body.getBoundingClientRect();var visible=[].some.call(document.body.querySelectorAll('*'),function(el){var b=el.getBoundingClientRect();return b.width>20&&b.height>20&&getComputedStyle(el).visibility!=='hidden'&&el.tagName!=='SCRIPT'});if(r.height<40||!visible)post({problem:'The interactive showed nothing on screen.'})},1200);});})();</script>
</head><body>${html}</body></html>`;
}

export function InteractiveFrame({ html, title, accent, minHeight = 260, onProblem, onScore }: { html: string; title?: string; accent?: string | null; minHeight?: number; onProblem?: (p: string) => void; onScore?: (pct: number) => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const id = useMemo(() => Math.random().toString(36).slice(2), []);
  const [h, setH] = useState(minHeight);
  const doc = useMemo(() => frameDoc(html, id, accent), [html, id, accent]);
  const cb = useRef(onProblem); cb.current = onProblem;
  const sc = useRef(onScore); sc.current = onScore;
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow || e.data?.cfFrame !== id) return;
      if (e.data.problem) { cb.current?.(String(e.data.problem).slice(0, 300)); return; }
      if (typeof e.data.score === 'number') { sc.current?.(Math.max(0, Math.min(100, Math.round(e.data.score)))); return; }
      const v = Number(e.data.h); if (v > 0) setH(Math.max(160, Math.min(1600, v + 4)));
    };
    window.addEventListener('message', on); return () => window.removeEventListener('message', on);
  }, [id]);
  return <iframe ref={ref} title={title || 'Interactive'} sandbox="allow-scripts" srcDoc={doc} style={{ width: '100%', height: h, border: 0, display: 'block', borderRadius: 18, background: 'transparent' }} loading="lazy" referrerPolicy="no-referrer" />;
}
