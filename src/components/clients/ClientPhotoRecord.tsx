'use client';
// src/components/clients/ClientPhotoRecord.tsx — A PHOTO'S RECORD, ON THE CLIENT'S PAGE (board 18D). The photo, marked
// or as it was before the client's marks; its layers (the client's marks, the team's, private team notes), each shown
// or hidden; what it may be used for; who can see it, who has opened it lately (noted each time, api/clients/photos)
// and how long it's kept. Download what's shown, open it in the markup tool (a photo on a visit that's still to come),
// or remove a photo the client sent when they ask (managers only, and it can't be undone).
import * as React from 'react';
import { format } from 'date-fns';
import { drawDoc } from '@/lib/markup/draw';
import { emptyDoc, viewOf, type Layer, type MarkupDoc } from '@/lib/markup/model';
import { altText } from '@/lib/markup/describe';
import { removable, type ClientPhoto } from '@/lib/client-photos';
import { useTeamPhoto } from '@/components/markup/useTeamPhoto';
import { TeamPhotoMarkup } from '@/components/markup/TeamPhotoMarkup';
import { usePrivateUrl, resolvePrivateUrl } from '@/components/shared/private-file';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { wallDate } from '@/lib/tenant-time';

const GOOD = '#1f7a4d', RED = '#b42318', WARN = '#b45309';
const ENDED = ['declined', 'expired', 'released', 'cancelled', 'canceled', 'no_show', 'completed'];
const muted: React.CSSProperties = { color: 'hsl(var(--muted-foreground))' };
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';
const ms = (v: any) => { const t = v?.toDate ? v.toDate().getTime() : Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; };

/** The photo drawn with the layers chosen (or as it was before any marks), the way the markup tool draws it. */
function LayeredPhoto({ src, doc, layers, original, alt, canvasRef, exportRef }: { src: string; doc: MarkupDoc | null; layers: Layer[]; original: boolean; alt: string; canvasRef: React.RefObject<HTMLCanvasElement | null>; exportRef: React.MutableRefObject<(() => Promise<Blob | null>) | null> }) {
  const [img, setImg] = React.useState<HTMLImageElement | null>(null); const [bad, setBad] = React.useState(false);
  // Download: what's shown, at the photo's own size (the screen's copy is smaller).
  React.useEffect(() => {
    exportRef.current = img ? async () => {
      const d = doc && doc.w === img.naturalWidth && doc.h === img.naturalHeight ? doc : emptyDoc(img.naturalWidth, img.naturalHeight);
      const v = viewOf(d); const k = Math.min(1, 4000 / Math.max(v.w, v.h)); const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(v.w * k)); c.height = Math.max(1, Math.round(v.h * k)); drawDoc(c.getContext('2d')!, d, img, { k, layers, original });
      return new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.92));
    } : null;
    return () => { exportRef.current = null; };
  }, [img, doc, layers, original, exportRef]);
  React.useEffect(() => { let gone = false; const i = new Image(); i.onload = () => { if (!gone) setImg(i); }; i.onerror = () => { if (!gone) setBad(true); }; i.src = src; return () => { gone = true; }; }, [src]);
  React.useEffect(() => {
    const c = canvasRef.current; if (!c || !img) return;
    const d = doc && doc.w === img.naturalWidth && doc.h === img.naturalHeight ? doc : emptyDoc(img.naturalWidth, img.naturalHeight);
    const v = viewOf(d); const k = Math.min(1, 1400 / Math.max(v.w, v.h));
    c.width = Math.max(1, Math.round(v.w * k)); c.height = Math.max(1, Math.round(v.h * k));
    try { drawDoc(c.getContext('2d')!, d, img, { k, layers, original }); } catch { setBad(true); }
  }, [img, doc, layers, original, canvasRef]);
  if (bad) return <p className="px-6 py-16 text-center text-[14px]" role="alert" style={{ color: WARN }}>This photo couldn’t be shown just now.</p>;
  return <canvas ref={canvasRef} role="img" aria-label={alt} className="mx-auto block max-h-[52vh] max-w-full" />;
}

const Switch = ({ on, label, onChange }: { on: boolean; label: string; onChange: () => void }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onChange} className="grid h-11 w-14 shrink-0 place-items-center">
    <span className="relative h-[26px] w-[44px] rounded-full transition" style={on ? { background: GOOD } : { background: 'hsl(var(--secondary))', boxShadow: 'inset 0 0 0 1.5px hsl(var(--muted-foreground))' }}>
      <span className="absolute top-[2px] h-[22px] w-[22px] rounded-full transition-all" style={{ left: on ? 20 : 2, background: '#fff', boxShadow: '0 1px 3px rgba(22,23,26,.3)' }} /></span></button>);
const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <section aria-label={label} className="space-y-1.5"><p className="px-1 text-[13px] font-semibold" style={muted}>{label}</p>
    <div className="divide-y overflow-hidden rounded-2xl" style={{ background: 'hsl(var(--secondary) / .55)', borderColor: 'hsl(var(--border))' }}>{children}</div></section>);
const Row = ({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) => (
  <div className="flex min-h-[52px] items-center gap-3 px-4 py-2" style={{ borderColor: 'hsl(var(--border))' }}>
    <div className="min-w-0 flex-1"><p className="text-[14.5px]">{title}</p>{sub && <p className="text-[12.5px] leading-snug" style={muted}>{sub}</p>}</div>{right}</div>);

export function ClientPhotoRecord({ tenantId, client, photo, appt, zone, me, isManager, nowUrl, onRemoved, solo = false }: {
  tenantId: string; client: any; photo: ClientPhoto; appt: any | null; zone?: string | null;
  me: { uid?: string | null; name?: string | null }; isManager: boolean;
  /** How it looks now, on the same visit (for Compare in the markup tool). */
  nowUrl?: string | null;
  onRemoved: (said: string) => void;
  /** One person sees every client (lib/business-shape): "only you", not "the team". */
  solo?: boolean;
}) {
  const name = first(client?.name) || 'The client';
  const [opened, setOpened] = React.useState<{ by: string; at: string }[] | 'failed' | null>(null);
  const [said, setSaid] = React.useState<{ text: string; ok?: boolean } | null>(null);
  const [marking, setMarking] = React.useState(false); const [nonce, setNonce] = React.useState(0);
  const [removing, setRemoving] = React.useState<false | 'ask' | 'busy'>(false);
  const post = async (body: any) => { const r = await fetch('/api/clients/photos', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, clientId: String(client.id), key: photo.id, ...(photo.apptId ? { apptId: photo.apptId } : {}), ...body }) }); return r.json().catch(() => null); };
  // Opening the record is noted (who, and when).
  React.useEffect(() => { let gone = false; setOpened(null); setSaid(null); setRemoving(false); post({ action: 'opened' }).then((d) => { if (!gone) setOpened(d?.ok ? d.opened : 'failed'); }).catch(() => { if (!gone) setOpened('failed'); }); return () => { gone = true; }; }, [photo.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const when = (v: number | string) => { const t = typeof v === 'number' ? v : ms(v); return t ? format(wallDate(new Date(t), zone || undefined), 'MMM d') : ''; };
  const visitWords = appt?.startTime ? `${format(wallDate(new Date(ms(appt.startTime)), zone || undefined), 'MMM d')}, ${String(appt.serviceName || 'visit').toLowerCase()}` : '';
  const from = photo.source === 'booking' ? `Sent by ${name} when booking${photo.at ? ` · ${when(photo.at)}` : ''}${visitWords ? ` · for ${visitWords}` : ''}`
    : photo.source === 'visit_link' ? `Sent by ${name} from their visit link${photo.at ? ` · ${when(photo.at)}` : ''}${visitWords ? ` · for ${visitWords}` : ''}`
    : photo.source === 'earlier' ? `Sent by ${name} earlier, before newer photos replaced it${visitWords ? ` · for ${visitWords}` : ''}`
    : photo.source === 'team' ? `${solo ? 'Taken by you' : 'Taken by the team'}${visitWords ? ` · ${visitWords}` : ''}`
    : `Brought over${photo.from ? ` from ${photo.from}` : ''}${photo.at ? ` · ${when(photo.at)}` : ''}`;
  const title = photo.kind === 'inspiration' ? `Inspiration photo ${photo.n}` : photo.kind === 'now' ? 'How it looked before' : photo.kind === 'after' ? `After photo ${photo.n}` : photo.kind === 'earlier' ? `Earlier inspiration photo ${photo.n}` : photo.note || 'A photo brought over';
  const layered = photo.kind === 'inspiration' && photo.current && !!photo.apptId;
  const open = !!appt && layered && !ENDED.includes(String(appt.status || '')) && Date.parse(String(appt.startTime || '')) > Date.now() - 12 * 3600e3;
  const removeOk = isManager && removable(photo) && !!photo.apptId;
  const canvas = React.useRef<HTMLCanvasElement>(null); const exporter = React.useRef<(() => Promise<Blob | null>) | null>(null);
  const byName = first(appt?.inspoTeam?.[photo.id]?.by); const teamBy = byName || 'The team'; const mine = !byName && solo;

  const download = async () => {
    setSaid(null);
    const save = (blob: Blob, ext: string) => { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = `${name.toLowerCase()}-${photo.kind}-${photo.n}.${ext}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); };
    try {
      if (exporter.current) { const blob = await exporter.current(); if (blob) { save(blob, 'jpg'); return; } }
      const url = await resolvePrivateUrl(photo.url); const r = await fetch(url); if (!r.ok) throw new Error('fetch');
      const blob = await r.blob(); save(blob, /png/.test(blob.type) ? 'png' : 'jpg');
    } catch { window.open(await resolvePrivateUrl(photo.url).catch(() => photo.url), '_blank', 'noopener'); }
  };
  const remove = async () => {
    setRemoving('busy'); setSaid(null);
    const d = await post({ action: 'remove', kind: photo.kind });
    if (d?.ok) { onRemoved(d.failed ? `Removed from the visit. ${d.failed === 1 ? 'One copy' : `${d.failed} copies`} couldn’t be deleted just now. ${d.failed === 1 ? 'It’s' : 'They’re'} tried again later, when ${name}’s photos are opened.`
      : d.shared ? `Removed from this visit. The same photo is on another of ${name}’s visits, so that copy is kept there.` : `Removed. ${name}’s photo and every copy kept here are deleted.`); return; }
    setRemoving(false); setSaid({ text: d?.error || 'That didn’t go through. Please try again.' });
  };
  const head = <div className="px-1"><h3 className="text-[17px] font-semibold">{title}</h3><p className="mt-0.5 text-[13.5px] leading-snug" style={muted}>{from}</p>
    {photo.note && photo.kind !== 'imported' && <p className="mt-2 text-[14px] leading-snug">“{photo.note}”</p>}</div>;
  const opener = opened === null ? 'Loading…' : opened === 'failed' ? 'Not available just now' : opened.length ? opened.slice(0, 3).map((o) => `${o.by}, ${when(o.at)}`).join(' · ') : 'Only you, just now';
  return (
    <article aria-label={title} className="overflow-hidden rounded-[24px]" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', boxShadow: '0 24px 48px -32px rgba(22,23,26,.35)' }}>
      {layered && appt ? <LayeredView key={`${photo.id}-${nonce}`} tenantId={tenantId} apptId={photo.apptId!} photo={photo} name={name} teamBy={teamBy} mine={mine} canvasRef={canvas} exportRef={exporter} head={head} solo={solo} />
        : <><PlainPhoto url={photo.url} alt={`${title}${photo.note ? `: ${photo.note}` : ''}`} /><div className="px-4 pt-4">{head}</div></>}
      <div className="space-y-4 p-4">
        <Group label="May be used for">
          <Row title={`${name}’s visits`} right={<span className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ background: 'rgba(31,122,77,.12)', color: GOOD }}>Always</span>} />
          <Row title="Your portfolio and marketing" sub={photo.kind === 'inspiration' || photo.kind === 'earlier' ? 'Never: it may be someone else’s work.' : client?.marketingConsent?.consented === true ? `${name} agreed to marketing use${client.marketingConsent.at ? ` on ${when(client.marketingConsent.at)}` : ''}. Ask before sharing a photo of them.` : `${name} hasn’t agreed to marketing use.`} />
        </Group>
        <Group label="Kept and seen">
          <Row title="Who can see it" sub={solo ? 'Nobody else works here' : `Everyone on the team who can open ${name}’s page`} right={<span className="text-[14px]">{solo ? 'Only you' : 'The team'}</span>} />
          <Row title="Opened by" sub="Noted each time it’s opened here" right={<span className="max-w-[55%] text-right text-[13.5px]">{opener}</span>} />
          <Row title="Kept" right={<span className="text-right text-[13.5px]" style={muted}>Until {name} asks to remove it</span>} />
        </Group>
        {removing === 'ask' || removing === 'busy' ? <div className="space-y-2 rounded-2xl p-4" role="alertdialog" aria-label="Remove this photo?" style={{ background: 'rgba(180,35,24,.06)' }} onKeyDown={(e) => { if (e.key === 'Escape' && removing === 'ask') { e.stopPropagation(); setRemoving(false); } }}>
            <p className="text-[14px] leading-snug">Remove this photo for good? It’s taken off the visit with any marks and notes on it, and every copy kept here is deleted. This can’t be undone.</p>
            <div className="flex flex-wrap gap-2"><button type="button" disabled={removing === 'busy'} onClick={() => void remove()} className="inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-semibold text-white disabled:opacity-50" style={{ background: RED }}>{removing === 'busy' ? 'Removing…' : 'Remove it'}</button>
              <button type="button" autoFocus disabled={removing === 'busy'} onClick={() => setRemoving(false)} className="inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-semibold" style={{ background: 'hsl(var(--secondary))' }}>Keep it</button></div></div>
          : <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void download()} className="inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-semibold" style={{ background: 'hsl(var(--secondary))' }}>Download</button>
              {open && <button type="button" onClick={() => setMarking(true)} className="inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-semibold" style={{ background: 'hsl(var(--secondary))' }}>Open in markup</button>}
              {removeOk && <button type="button" onClick={() => { setRemoving('ask'); setSaid(null); }} className="inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-semibold" style={{ background: 'rgba(180,35,24,.08)', color: RED }}>Remove</button>}
            </div>}
        {said && <p className="px-1 text-[13.5px]" role={said.ok ? 'status' : 'alert'} style={{ color: said.ok ? GOOD : WARN }}>{said.text}</p>}
      </div>
      {marking && appt && <TeamPhotoMarkup key={photo.id} tenantId={tenantId} apptId={String(appt.id)} photo={(Array.isArray(appt.inspirationPhotos) ? appt.inspirationPhotos : []).find((p: any) => p?.url === photo.url) || { url: photo.url, note: photo.note, ...(photo.original ? { original: photo.original } : {}), ...(photo.markup ? { markup: photo.markup } : {}) }}
        n={photo.n} of={(appt.inspirationPhotos || []).length || 1} title={`${String(appt.serviceName || 'Visit')}${ms(appt.startTime) ? `, ${format(wallDate(new Date(ms(appt.startTime)), zone || undefined), 'EEE h:mm a')}` : ''}`}
        clientName={String(client?.name || appt.clientName || '')} me={me} nowUrl={nowUrl || null} solo={solo} onClose={(t) => { setMarking(false); setNonce((x) => x + 1); if (t) setSaid({ text: t, ok: true }); }} />}
    </article>);
}

/** A photo with no layers: shown as it is. */
function PlainPhoto({ url, alt }: { url: string; alt: string }) {
  const src = usePrivateUrl(url); const [bad, setBad] = React.useState(false);
  return <div className="grid min-h-[200px] place-items-center" style={{ background: 'hsl(var(--secondary))' }}>
    {bad ? <p className="px-6 py-16 text-center text-[14px]" role="alert" style={{ color: WARN }}>This photo couldn’t be shown just now.</p>
      : src ? <img src={src} alt={alt} onError={() => setBad(true)} className="mx-auto block max-h-[52vh] max-w-full" /> : <p className="py-16 text-[14px]" style={muted}>Opening…</p>}</div>;
}

/** An inspiration photo the client sent for a visit: drawn with its layers (the client's, the team's, private notes). */
function LayeredView({ tenantId, apptId, photo, name, teamBy, mine = false, canvasRef, exportRef, head, solo = false }: { tenantId: string; apptId: string; photo: ClientPhoto; name: string; teamBy: string; mine?: boolean; canvasRef: React.RefObject<HTMLCanvasElement | null>; exportRef: React.MutableRefObject<(() => Promise<Blob | null>) | null>; head: React.ReactNode; solo?: boolean }) {
  const { ready } = useTeamPhoto(tenantId, apptId, { url: photo.url, original: photo.original, markup: photo.markup });
  const [mode, setMode] = React.useState<'marked' | 'original'>('marked');
  const [shown, setShown] = React.useState<Layer[]>(['client', 'team']);
  if (ready === 'loading') return <><div className="grid min-h-[240px] place-items-center" style={{ background: 'hsl(var(--secondary))' }}><p className="text-[14px]" style={muted}>Opening…</p></div><div className="px-4 pt-4">{head}</div></>;
  if ('error' in ready) return <><PlainPhoto url={photo.url} alt={`Inspiration photo ${photo.n}`} /><div className="px-4 pt-4">{head}</div></>;
  const doc = ready.doc; const count = (l: Layer) => { const m = doc ? doc.marks.filter((x) => x.layer === l) : []; const pins = m.filter((x) => x.kind === 'pin').length; const r = m.length - pins; return { n: m.length, words: [r ? `${r} mark${r === 1 ? '' : 's'}` : '', pins ? `${pins} pin${pins === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ') }; };
  const c = count('client'), t = count('team'), p = count('private');
  const teamTitle = mine ? 'Your marks' : `${teamBy}’s marks`;
  const canOriginal = ready.base === 'original' && !ready.direct;
  // From the original, a layer's switch shows the marks again with that layer on.
  const toggle = (l: Layer) => { if (mode === 'original') { setMode('marked'); setShown((s) => (s.includes(l) ? s : [...s, l])); return; } setShown((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l])); };
  const layers = mode === 'original' ? [] : shown;
  const alt = mode === 'original' ? `Inspiration photo ${photo.n}, before any marks` : altText(doc ? { ...doc, marks: doc.marks.filter((m) => layers.includes(m.layer)) } : null, photo.note, layers.length ? layers : ['client']);
  return (
    <>
      <div className="relative" style={{ background: 'hsl(var(--secondary))' }}>
        {ready.direct ? <PlainPhoto url={photo.url} alt={alt} /> : <LayeredPhoto src={ready.src} doc={doc} layers={layers} original={mode === 'original'} alt={alt} canvasRef={canvasRef} exportRef={exportRef} />}
        {canOriginal && <div className="absolute left-3 top-3 flex gap-1.5" role="group" aria-label="Show">
          {(['marked', 'original'] as const).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className="inline-flex min-h-11 items-center rounded-full px-4 text-[13.5px] font-semibold"
            style={mode === m ? { background: '#16171a', color: '#fff' } : { background: 'rgba(255,255,255,.94)', color: '#16171a' }}>{m === 'marked' ? 'Marked' : 'Original'}</button>)}</div>}
      </div>
      <div className="px-4 pt-4">{head}</div>
      {(c.n > 0 || t.n > 0 || p.n > 0 || (ready.base === 'photo' && photo.markup)) && <div className="px-4 pt-4"><Group label="Layers">
        {ready.base === 'original' && c.n > 0 && <Row title={`${name}’s marks`} sub={c.words} right={<Switch on={mode === 'marked' && shown.includes('client')} label={`Show ${name}’s marks`} onChange={() => { toggle('client'); }} />} />}
        {ready.base === 'photo' && photo.markup && <Row title={`${name}’s marks`} sub="Part of this photo (the photo before them couldn’t be opened)" />}
        {t.n > 0 && <Row title={teamTitle} sub={t.words} right={<Switch on={mode === 'marked' && shown.includes('team')} label={mine ? 'Show your marks' : `Show ${teamBy}’s marks`} onChange={() => { toggle('team'); }} />} />}
        {p.n > 0 && <Row title={solo ? 'Private notes' : 'Private team notes'} sub={`Never shown to ${name}`} right={<Switch on={mode === 'marked' && shown.includes('private')} label={solo ? 'Show private notes' : 'Show private team notes'} onChange={() => { toggle('private'); }} />} />}
      </Group></div>}
    </>);
}

