'use client';
// src/components/academy/CourseShare.tsx — share an online course anywhere:
// copy the link, the phone's share sheet, text, email, or a QR code for
// flyers and the front desk. Works for any academy (not only licensed schools).
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function CourseShare({ url, title, price, school, onClose }: { url: string; title: string; price: string; school: string; onClose: () => void }) {
  const [qr, setQr] = useState(''); const [msg, setMsg] = useState('');
  const text = `${title}${price ? ` (${price})` : ''} — an online course from ${school}. Start any time:`;
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 600 }).then(setQr).catch(() => setQr('')); }, [url]);
  const copy = async (v: string, done: string) => { try { await navigator.clipboard.writeText(v); setMsg(done); } catch { setMsg('Couldn’t copy — press and hold the link to copy it.'); } };
  const canShare = typeof navigator !== 'undefined' && !!(navigator as any).share;
  const btn = 'flex h-11 items-center justify-center rounded-xl border-2 px-3 text-sm font-bold';
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-t-3xl bg-background p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Share ${title}`}>
        <div className="flex items-start justify-between gap-2"><div><p className="font-black">Share “{title}”</p><p className="text-[12px] text-muted-foreground">Anyone with the link can see the course and buy it.</p></div><button type="button" onClick={onClose} aria-label="Close" className="p-1 text-lg">✕</button></div>
        <div className="flex gap-2"><input readOnly value={url} className="h-11 min-w-0 flex-1 rounded-xl border-2 bg-muted/40 px-3 text-sm" aria-label="Course link" onFocus={(e) => e.target.select()} /><button type="button" onClick={() => copy(url, 'Link copied.')} className="h-11 shrink-0 rounded-xl bg-foreground px-4 text-sm font-bold text-background">Copy</button></div>
        <div className="grid grid-cols-2 gap-2">
          {canShare && <button type="button" onClick={() => (navigator as any).share({ title, text, url }).catch(() => {})} className={`${btn} col-span-2 bg-foreground text-background`}>Share…</button>}
          <a href={`sms:?&body=${encodeURIComponent(`${text} ${url}`)}`} className={btn}>💬 Text</a>
          <a href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`} className={btn}>✉️ Email</a>
          <button type="button" onClick={() => copy(`${text} ${url}`, 'Post text copied — paste it into Instagram, Facebook or TikTok.')} className={`${btn} col-span-2`}>📋 Copy a ready-made post</button>
        </div>
        {qr && <div className="flex items-center gap-3 rounded-2xl bg-muted/40 p-3"><img src={qr} alt={`QR code for ${title}`} className="h-24 w-24 rounded-lg bg-white" /><div className="space-y-1"><p className="text-sm font-bold">QR code</p><p className="text-[12px] text-muted-foreground">For flyers, business cards or your front desk.</p><a href={qr} download={`${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-qr.png`} className="text-[12px] font-bold underline">Download</a></div></div>}
        {msg && <p className="text-sm text-emerald-800" role="status">{msg}</p>}
      </div>
    </div>
  );
}
