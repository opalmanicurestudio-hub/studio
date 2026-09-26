'use client';
// src/components/academy/InteractiveFrame.tsx
//
// Runs an AI-built interactive (self-contained HTML) in a SEALED frame:
//   • sandbox="allow-scripts" only — no same-origin (so no access to this
//     page, the student's account, cookies or storage), no popups, no forms,
//     no navigating the page
//   • a Content-Security-Policy inside the frame blocks ALL network access —
//     nothing can load from or send to the internet
//   • it reports its own height so it fits its content (only messages from
//     this frame are accepted)
//   • animations pause for people whose device asks for reduced motion

import { useEffect, useMemo, useRef, useState } from 'react';

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";
export function frameDoc(html: string, frameId: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:transparent;color:#1c1917;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}body{padding:12px}svg,canvas,img{max-width:100%}button,input,select{font:inherit}button{min-height:40px;padding:6px 12px;border-radius:10px;border:1.5px solid #d6d3d1;background:#fff;cursor:pointer}input[type=range]{width:100%;accent-color:#7c3aed}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-play-state:paused!important;transition:none!important}}</style></head>
<body>${html}<script>(function(){var id=${JSON.stringify(frameId)};function send(){try{parent.postMessage({cfFrame:id,h:Math.ceil(document.documentElement.scrollHeight)},'*')}catch(e){}}
window.addEventListener('load',send);new ResizeObserver(send).observe(document.body);setTimeout(send,300);setTimeout(send,1200);})();</script></body></html>`;
}

export function InteractiveFrame({ html, title, minHeight = 260 }: { html: string; title?: string; minHeight?: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const id = useMemo(() => Math.random().toString(36).slice(2), []);
  const [h, setH] = useState(minHeight);
  const doc = useMemo(() => frameDoc(html, id), [html, id]);
  useEffect(() => {
    const on = (e: MessageEvent) => { if (e.source !== ref.current?.contentWindow || e.data?.cfFrame !== id) return; const v = Number(e.data.h); if (v > 0) setH(Math.max(160, Math.min(1600, v + 4))); };
    window.addEventListener('message', on); return () => window.removeEventListener('message', on);
  }, [id]);
  return <iframe ref={ref} title={title || 'Interactive'} sandbox="allow-scripts" srcDoc={doc} style={{ width: '100%', height: h, border: 0, display: 'block', borderRadius: 16, background: 'white' }} loading="lazy" referrerPolicy="no-referrer" />;
}
