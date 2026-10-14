'use client';
// src/components/documents/DocBlocks.tsx — HOW A DOCUMENT READS (lib/doc-blocks), in the app's look: numbered steps with
// their photos and timer, boxed warnings, tips, pictures, videos and checklists. Used by the main app, the staff app and
// previews. A checklist can be made tickable by passing renderChecklist (the staff app's runs).
import * as React from 'react';
import { checklistLines, needsPhoto } from '@/lib/doc-items';
import { videoEmbed, lines } from '@/lib/doc-blocks';

const INK = 'hsl(var(--foreground))', MUTED = 'hsl(var(--muted-foreground))', LINE = 'hsl(var(--border))', SOFT = 'hsl(var(--secondary))', AMBER = '#b45309', BLUE = '#3d5a99';
export const Ico = ({ d, s = 18, c = 'currentColor', w = 1.8 }: { d: string; s?: number; c?: string; w?: number }) => <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />;
export const IC = { warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>', tip: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', play: '<path d="M7 4l13 8-13 8z"/>', check: '<path d="M5 12l5 5 9-10"/>', cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', back: '<path d="M15 5l-7 7 7 7"/>' };

export function StepNum({ n, size = 28 }: { n: number; size?: number }) {
  return <span className="flex shrink-0 items-center justify-center rounded-full font-bold text-background" style={{ width: size, height: size, background: INK, fontSize: size * 0.46 }}>{n}</span>;
}
export function Images({ urls, big = false }: { urls?: string[]; big?: boolean }) {
  if (!urls?.length) return null;
  return <div className={`grid gap-2 ${urls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>{urls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="w-full rounded-[14px] object-cover" style={{ height: big ? 240 : urls.length > 1 ? 120 : 180, background: SOFT }} /></a>)}</div>;
}
export function Video({ url, caption }: { url?: string; caption?: string }) {
  const v = videoEmbed(url || ''); if (!v) return null;
  return <figure className="space-y-1.5">
    {v.kind === 'embed' ? <div className="relative overflow-hidden rounded-[14px]" style={{ paddingTop: '56.25%', background: '#000' }}><iframe src={v.src} title={caption || 'Video'} className="absolute inset-0 h-full w-full" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" /></div>
      : v.kind === 'file' ? <video src={v.src} controls playsInline className="w-full rounded-[14px] bg-foreground" /> : <a href={v.src} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-[14px] px-4 py-3 text-[14px] font-medium" style={{ background: SOFT }}><Ico d={IC.play} s={16} />Watch the video</a>}
    {caption && <figcaption className="text-[13px]" style={{ color: MUTED }}>{caption}</figcaption>}
  </figure>;
}
export function Callout({ kind, heading, body }: { kind: 'warning' | 'tip'; heading?: string; body?: string }) {
  const warn = kind === 'warning';
  return <div className="flex gap-2.5 rounded-[14px] px-3.5 py-3 text-[14px] leading-relaxed" style={warn ? { background: 'color-mix(in srgb, #b45309 10%, transparent)', color: 'var(--warn-ink)' } : { background: SOFT, color: '#3c3e42' }}>
    <span className="mt-0.5"><Ico d={warn ? IC.warn : IC.tip} s={18} c={warn ? AMBER : MUTED} /></span>
    <span className="min-w-0">{heading && <b className="block font-semibold">{heading}</b>}{body && <span className="whitespace-pre-wrap">{body}</span>}</span></div>;
}

export function DocBlocks({ sections, renderChecklist, gap = 16 }: { sections: any[]; renderChecklist?: (sec: any) => React.ReactNode; gap?: number }) {
  let n = 0;
  return <div className="flex flex-col" style={{ gap, color: INK }}>
    {(sections || []).map((sec: any) => {
      const t = sec?.type || 'text';
      if (t === 'step') { n += 1; return <div key={sec.id} className="flex items-start gap-3"><StepNum n={n} /><div className="min-w-0 flex-1 space-y-2">
        {sec.heading && <p className="text-[16px] font-semibold leading-snug">{sec.heading}</p>}{sec.body && <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed" style={{ color: '#3c3e42' }}>{sec.body}</p>}
        <Images urls={sec.images} />{sec.timerMin ? <span className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold" style={{ background: '#e3efed', color: '#2f6f6a' }}><Ico d={IC.clock} s={14} c="#2f6f6a" />Timer · {sec.timerMin} min</span> : null}</div></div>; }
      if (t === 'normal' || t === 'callus') { const call = t === 'callus'; const fg = call ? '#7a1d14' : '#1f5a3a';
        return <div key={sec.id} className="rounded-[16px] p-3.5" style={{ background: call ? '#fdecec' : '#e9f3ed', color: fg }}>
          <p className="pb-1 text-[15px] font-bold">{sec.heading || (call ? 'Call us if' : 'What’s normal')}</p>
          {lines(sec).map((it, i) => <div key={i} className="flex gap-2.5 py-1 text-[14.5px] leading-snug"><span className="w-3 shrink-0 font-bold">{call ? '!' : <Ico d={IC.check} s={14} c={fg} w={2.4} />}</span><span>{it}</span></div>)}</div>; }
      if (t === 'warning' || t === 'tip') return <Callout key={sec.id} kind={t} heading={sec.heading} body={sec.body} />;
      if (t === 'photo') return <figure key={sec.id} className="space-y-1.5">{sec.heading && <p className="text-[15px] font-semibold">{sec.heading}</p>}<Images urls={sec.images} big />{sec.body && <figcaption className="text-[13px]" style={{ color: MUTED }}>{sec.body}</figcaption>}</figure>;
      if (t === 'video') return <div key={sec.id} className="space-y-1.5">{sec.heading && <p className="text-[15px] font-semibold">{sec.heading}</p>}<Video url={sec.url} caption={sec.body} /></div>;
      if (t === 'checklist') {
        if (renderChecklist) return <React.Fragment key={sec.id}>{renderChecklist(sec)}</React.Fragment>;
        const items = checklistLines(sec);
        return <div key={sec.id} className="rounded-[16px] border p-3.5" style={{ borderColor: LINE }}>
          {sec.heading && <p className="mb-2 text-[15px] font-semibold">{sec.heading}</p>}
          <div className="space-y-2">{items.map((it, i) => <div key={i} className="flex items-start gap-2.5 text-[14.5px]"><span className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded-[6px] border-2" style={{ borderColor: 'hsl(var(--border))' }} /><span className="min-w-0 flex-1">{it}</span>{needsPhoto(sec, i) && <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] font-semibold" style={{ background: 'color-mix(in srgb, #3d5a99 12%, transparent)', color: BLUE }}><Ico d={IC.cam} s={12} c={BLUE} />Photo</span>}</div>)}</div></div>;
      }
      return <div key={sec.id}>{sec.heading && <p className="text-[16px] font-semibold">{sec.heading}</p>}{sec.body && <p className="mt-1 whitespace-pre-wrap text-[14.5px] leading-relaxed" style={{ color: '#3c3e42' }}>{sec.body}</p>}</div>;
    })}
  </div>;
}
