'use client';
// src/components/markup/TeamPhotoMarkup.tsx — THE TEAM MARKS UP A CLIENT'S PHOTO (board 17C). From the appointment's
// "Before the visit", one of the inspiration photos the client sent opens in the one markup tool (MarkupEditor), on a
// computer with the tools down the side. The client's marks are shown on their own layer and never changed here; the
// team adds their own marks (which the client sees once they're sent) and private team notes (which they never do).
// The photo is drawn on in the browser, so it's opened through this app (useTeamPhoto): the photo before its marks when
// it was kept, else the photo as sent (the client's marks are part of it then).
//   Save for the team   kept beside the visit; the client sees nothing yet
//   Send to Dana        the photo without marks and each layer of marks over it are saved under the visit
//                       (api/upload/appointment-photos), then the visit link shows them with the note (lib/markup/team)
// Compare: how it looks now beside this photo, when the client sent one. It opens over the appointment's own sheet as a
// dialog of its own (OverSheet), so the keys and the pointer work. One photo for each time it's opened (the caller keys
// it by the photo): a newer photo from the client opens afresh.
import * as React from 'react';
import { MarkupEditor, type MarkupResult } from '@/components/markup/MarkupEditor';
import { PhotoCompare } from '@/components/markup/PhotoCompare';
import { OverSheet } from '@/components/markup/OverSheet';
import { flatten, overlay } from '@/lib/markup/draw';
import { packDoc } from '@/lib/markup/model';
import { teamPart } from '@/lib/markup/team';
import { useTeamPhoto } from '@/components/markup/useTeamPhoto';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { resolvePrivateUrl } from '@/components/shared/private-file';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', WARN = '#b45309', GOOD = '#1f7a4d';
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';

export function TeamPhotoMarkup({ tenantId, apptId, photo, n, of, title, clientName, me, nowUrl, onClose, solo = false }: {
  tenantId: string; apptId: string;
  /** The photo as the client sent it ({ url, note, original?, markup? }). */
  photo: any;
  /** Which photo it is ("photo 1 of 3"). */
  n: number; of: number;
  /** What the visit is ("Gel manicure, Sat 3:30 PM"). */
  title: string; clientName: string;
  me: { uid?: string | null; name?: string | null };
  /** How it looks now, when the client sent one (for Compare). */
  nowUrl?: string | null;
  /** Closed: with what to say on the appointment once it's saved or sent. */
  onClose: (said?: string) => void;
  /** One person sees every client (lib/business-shape): no "team" in the words. */
  solo?: boolean;
}) {
  const client = first(clientName) || 'the client'; const myName = first(me?.name);
  const { ready, call } = useTeamPhoto(tenantId, apptId, photo);
  const [comparing, setComparing] = React.useState<'loading' | { now: string; goal: string } | null>(null); const [compareErr, setCompareErr] = React.useState(false);

  const upload = async (dataUrl: string, name: string): Promise<string> => {
    const blob = await (await fetch(dataUrl)).blob();
    const fd = new FormData(); fd.append('tenantId', tenantId); fd.append('appointmentId', apptId); fd.append('files', new File([blob], name, { type: blob.type }));
    const r = await fetch('/api/upload/appointment-photos', { method: 'POST', headers: await staffAuthHeader(), body: fd });
    const d = await r.json().catch(() => null);
    if (!d?.ok || !d.urls?.[0]) throw new Error(d?.error || 'upload');
    return String(d.urls[0]);
  };
  const packed = (res: MarkupResult, colors: string[]) => packDoc(teamPart(res.doc, colors));

  if (typeof document === 'undefined') return null;
  const label = `Mark up inspiration photo ${n}`;
  if (ready === 'loading' || 'error' in ready) {
    const err = ready === 'loading' ? null : ready.error;
    return (
      <OverSheet label={label}>
        <div className="fixed inset-0 grid place-items-center p-6" style={{ background: '#fff', color: INK }}>
          <div className="max-w-sm space-y-4 text-center">
            <p className="text-[15px]" role={err ? 'alert' : 'status'} style={{ color: err ? WARN : MUTED }}>{err || 'Opening the photo…'}</p>
            <button type="button" onClick={() => onClose()} autoFocus className="inline-flex min-h-11 items-center rounded-full px-5 text-[15px] font-semibold" style={{ background: SOFT, color: INK }}>{err ? 'Back' : 'Cancel'}</button>
          </div>
        </div>
      </OverSheet>);
  }
  const r = ready;
  const send = async (res: MarkupResult): Promise<string | null> => {
    const team = teamPart(res.doc, r.clientColors);
    if (!team.marks.some((m) => m.layer === 'team') && !res.note.trim()) return `Add a mark or a note for ${client} first. Private notes are never sent: ${solo ? 'save them instead' : 'save them for the team'}.`;
    const markup = packed(res, r.clientColors); if (!markup) return 'There are too many marks to keep. Remove a few and try again.';
    let img: HTMLImageElement;
    try { img = new Image(); img.src = r.src; await img.decode(); } catch { return 'The photo couldn’t be read just now. Please try again.'; }
    let urls: { base: string; mine: string | null; theirs: string; w: number; h: number };
    try {
      const plain = flatten(res.doc, img, []).canvas; const theirs = overlay(res.doc, img, ['team']);
      // The client's own layer, every mark of it (some may not be shown here on a photo that's full), in the team's view.
      const clientMarks = r.base === 'original' && r.clientMarks.length ? overlay({ ...res.doc, marks: r.clientMarks }, img, ['client']) : null;
      const [b, t, m] = await Promise.all([upload(plain.toDataURL('image/jpeg', 0.86), 'photo.jpg'), upload(theirs.toDataURL('image/png'), 'team.png'), clientMarks ? upload(clientMarks.toDataURL('image/png'), 'client.png') : Promise.resolve(null)]);
      urls = { base: b, theirs: t, mine: m, w: plain.width, h: plain.height };
    } catch { return 'The marked-up photo didn’t upload. Check your connection and try again.'; }
    try {
      const resp = await call({ action: 'send', base: r.base, markup, note: res.note, images: urls }); const d = await resp.json().catch(() => null);
      if (!d?.ok) return d?.error || 'That didn’t send. Please try again.';
      onClose(d.told === 'sent' ? `Sent. ${client} was told, and sees your marks on their visit link.`
        : d.told === 'later' ? `Sent. ${client} sees your marks on their visit link.`
        : d.told === 'off' ? `Sent to ${client}’s visit link. They’ve chosen not to get messages, so they weren’t told.`
        : d.told === 'no_contact' ? `Sent to ${client}’s visit link. There’s no phone number or email to tell them.`
        : `Sent to ${client}’s visit link. The message telling them didn’t go out.`);
      return null;
    } catch { return 'That didn’t send. Check your connection and try again.'; }
  };
  const save = async (res: MarkupResult): Promise<string | null> => {
    const markup = packed(res, r.clientColors); if (!markup) return 'There are too many marks to keep. Remove a few and try again.';
    try {
      const resp = await call({ action: 'save', base: r.base, markup, note: res.note }); const d = await resp.json().catch(() => null);
      if (!d?.ok) return d?.error || 'That didn’t save. Please try again.';
      const savedWords = solo ? 'Saved.' : 'Saved for the team.';
      onClose(r.sentAt ? `${savedWords} ${client} still sees the marks you sent before.` : `${savedWords} ${client} sees nothing yet.`); return null;
    } catch { return 'That didn’t save. Check your connection and try again.'; }
  };
  const openCompare = async () => {
    if (!nowUrl || comparing) return; setCompareErr(false); setComparing('loading');
    try { const [now, goal] = await Promise.all([resolvePrivateUrl(String(nowUrl)), resolvePrivateUrl(String(photo.url))]); setComparing({ now, goal }); }
    catch { setComparing(null); setCompareErr(true); }
  };
  const clientNote = String(photo?.note || '').trim();
  const aside = (
    <section aria-label={`What ${client} sent`} className="space-y-2">
      {r.dropped && <p className="text-[13.5px] leading-snug" role="status" style={{ color: WARN }}>The marks saved before were made on another copy of this photo, so this starts fresh.</p>}
      {r.cut && <p className="text-[13.5px] leading-snug" role="status" style={{ color: MUTED }}>This photo holds only so many marks, so some of {client}’s aren’t shown here. They’re all still on their photo.</p>}
      {r.direct && <p className="text-[13.5px] leading-snug" style={{ color: MUTED }}>This photo came from another site, so it may only be looked at here.</p>}
      {(clientNote || r.clientColors.length > 0 || r.base === 'photo') && <div className="space-y-1.5 rounded-2xl p-3" style={{ background: '#fff', boxShadow: `inset 0 0 0 1px ${LINE}` }}>
        {clientNote && <p className="text-[14px] leading-snug"><span className="font-semibold">{client}’s note: </span>“{clientNote}”</p>}
        {r.clientColors.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="text-[13px]" style={{ color: MUTED }}>Colors {client} loves</span>{r.clientColors.map((c) => <span key={c} title={c.toUpperCase()} className="h-6 w-6 rounded-md" style={{ background: c, boxShadow: `inset 0 0 0 1px ${LINE}` }} />)}</div>}
        {r.base === 'photo' && photo?.markup == null && <p className="text-[13px] leading-snug" style={{ color: MUTED }}>{client}’s marks are part of this photo.</p>}
        {r.base === 'photo' && photo?.markup != null && <p className="text-[13px] leading-snug" style={{ color: MUTED }}>The photo before {client}’s marks couldn’t be opened, so their marks are part of this one.</p>}
      </div>}
      <p className="text-[13px]" style={{ color: r.sentAt ? GOOD : MUTED }}>{r.sentAt ? `Your marks were sent to ${client}. Sending again shows the new ones.` : `${client} sees your marks once you send them. Private notes are never sent.`}</p>
    </section>);
  const headerExtra = nowUrl ? (
    <button type="button" onClick={() => void openCompare()} className="inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-[14px] font-semibold" style={{ background: '#fff', color: compareErr ? WARN : INK, boxShadow: `inset 0 0 0 1px ${LINE}` }}>
      {comparing === 'loading' ? 'Opening…' : compareErr ? 'Compare: try again' : 'Compare with now'}</button>) : null;
  return (
    <OverSheet label={label}>
      <MarkupEditor inline src={r.src} doc={r.doc} layer="team" editLayers={['team', 'private']} sendLayers={['client', 'team']} by={first(me?.name) || undefined} clientName={client}
        layerNames={{ team: myName ? `${myName}’s marks` : 'Your marks', private: solo ? 'Private notes' : 'Private team notes' }} title={`Inspiration photo ${n} of ${of} · ${title}`} backLabel={clientName || 'Back'} doneLabel={`Send to ${client}`}
        alt={{ label: solo ? 'Save without sending' : 'Save for the team', onDone: save }} onDone={send} onCancel={() => onClose()} initialNote={r.note} aside={aside} headerExtra={headerExtra} />
      {comparing && comparing !== 'loading' && <PhotoCompare inline viewer="team" now={{ src: comparing.now, label: 'Now' }} goals={[{ src: comparing.goal, label: `Photo ${n}` }]} onClose={() => setComparing(null)} />}
    </OverSheet>);
}

