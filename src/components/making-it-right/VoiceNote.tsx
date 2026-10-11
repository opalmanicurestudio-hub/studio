'use client';
// src/components/making-it-right/VoiceNote.tsx — a voice note in any language (recorded on the phone; the words are heard live
// by the phone's own browser where it can, and written out on the server otherwise — lib/voice-transcribe), plus photo shrinking for uploads. Used by
// the client's "How was your visit?" page and the staff app's incident and "your side" forms.
import * as React from 'react';
const MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f6', RED = '#b42318';

export async function shrink(file: File): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const max = 1400; const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
export const blobToDataUrl = (b: Blob, mime: string) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(`data:${mime};base64,${String(r.result).split(',')[1]}`); r.readAsDataURL(b); });

export function Voice({ onDone, lang }: { onDone: (v: { blob: Blob; mime: string; seconds: number; transcript: string } | null) => void; lang: string }) {
  const [state, setState] = React.useState<'idle' | 'rec' | 'done'>('idle'); const [secs, setSecs] = React.useState(0); const [url, setUrl] = React.useState(''); const [heard, setHeard] = React.useState('');
  const rec = React.useRef<any>(null); const sr = React.useRef<any>(null); const timer = React.useRef<any>(null); const text = React.useRef('');
  const supported = typeof window !== 'undefined' && typeof (window as any).MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  if (!supported) return null;
  const stop = () => { try { rec.current?.stop(); } catch { /* already stopped */ } try { sr.current?.stop(); } catch { /* fine */ } clearInterval(timer.current); };
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => (window as any).MediaRecorder.isTypeSupported?.(m)) || 'audio/webm';
      const r = new (window as any).MediaRecorder(stream, { mimeType: mime }); const chunks: Blob[] = []; const t0 = Date.now();
      r.ondataavailable = (e: any) => e.data.size && chunks.push(e.data);
      r.onstop = () => { stream.getTracks().forEach((x) => x.stop()); const blob = new Blob(chunks, { type: mime }); setUrl(URL.createObjectURL(blob)); setState('done'); onDone({ blob, mime, seconds: Math.round((Date.now() - t0) / 1000), transcript: text.current.trim() }); };
      rec.current = r; r.start(); setState('rec'); setSecs(0); text.current = ''; setHeard('');
      timer.current = setInterval(() => setSecs((s) => { if (s + 1 >= 90) stop(); return s + 1; }), 1000);
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SR) { const s = new SR(); s.lang = lang; s.continuous = true; s.interimResults = false; s.onresult = (e: any) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text.current += ` ${e.results[i][0].transcript}`; setHeard(text.current.trim()); }; try { s.start(); sr.current = s; } catch { /* no live words — the recording still goes */ } }
    } catch { alert('We couldn’t use your microphone. You can type instead.'); }
  };
  return (
    <div className="space-y-2">
      {state === 'idle' && <button type="button" onClick={start} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border text-[15px] font-semibold" style={{ borderColor: LINE }}><span className="inline-block h-3 w-3 rounded-full" style={{ background: RED }} />Or record a voice note</button>}
      {state === 'rec' && <button type="button" onClick={stop} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold text-white" style={{ background: RED }}><span className="inline-block h-3 w-3 animate-pulse rounded-sm bg-white" />Recording {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} — tap to stop</button>}
      {state === 'done' && <div className="space-y-2 rounded-2xl p-3" style={{ background: SOFT }}><audio controls src={url} className="w-full" />{heard && <p className="text-[13.5px]" style={{ color: MUTED }}>“{heard}”</p>}<button type="button" className="text-[14px] underline" onClick={() => { setState('idle'); setUrl(''); onDone(null); }}>Record again</button></div>}
      <p className="text-[12.5px]" style={{ color: MUTED }}>Any language is fine — we’ll translate it for the team.</p>
    </div>);
}

