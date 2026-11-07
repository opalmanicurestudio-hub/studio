'use client';
// src/components/visit/PhotosAskCard.tsx — a different inspiration photo, on the visit link (board FormsStaff: "ask
// for different photos"). When the team asks for different photos, the visit link shows who asked and their note, the
// same photo tool as booking (PhotoMarkup: circles, arrows and a note on each), and Send. The photos go to the visit
// (api/checkin/actions "photos"), the person doing it hears about it, and the page thanks them (PhotosSentCard) in its
// place, since the ask is gone from the visit once they've sent.
import * as React from 'react';
import { VisitCard, VisitButton } from '@/components/booking/VisitShell';
import { PhotoMarkup } from '@/components/booking/PhotoMarkup';
import { visitDevice } from '@/components/visit/VerifyCard';

export function PhotosAskCard({ ask, token, tenantId, accent, onSent }: { ask: { note: string | null; by: string | null }; token: string; tenantId: string; accent: string; onSent: (thanks: string) => void }) {
  const [photos, setPhotos] = React.useState<any[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [said, setSaid] = React.useState<{ text: string; ok?: boolean } | null>(null);
  const send = async () => {
    if (!photos.length || busy) return;
    setBusy(true); setSaid(null);
    try {
      const r = await fetch('/api/checkin/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'photos', token, device: visitDevice(), photos: photos.map((p) => ({ url: p.url, note: p.note || '' })) }) });
      const d = await r.json().catch(() => null);
      if (d?.ok) { const thanks = `Sent. ${ask.by || 'The team'} will see them before your visit.`; setSaid({ ok: true, text: thanks }); setPhotos([]); onSent(thanks); }
      else setSaid({ text: d?.error || 'Your photos didn’t send. Please try again.' });
    } catch { setSaid({ text: 'Your photos didn’t send. Check your connection and try again.' }); } finally { setBusy(false); }
  };
  if (said?.ok) return <PhotosSentCard text={said.text} />;
  return (
    <VisitCard>
      <section aria-label="A different inspiration photo" className="space-y-3">
        <div>
          <p className="text-[16px] font-semibold">{ask.by ? `${ask.by} asked for a different inspiration photo` : 'A different inspiration photo, please'}</p>
          {ask.note && <p className="mt-1 text-[14.5px] leading-snug">“{ask.note}”</p>}
        </div>
        <PhotoMarkup tenantId={tenantId} value={photos} onChange={setPhotos} accent={accent} />
        {said && <p className="text-[14px]" role="alert" style={{ color: 'var(--warn, #b45309)' }}>{said.text}</p>}
        <VisitButton onClick={() => void send()} disabled={!photos.length || busy}>{busy ? 'Sending…' : photos.length > 1 ? `Send ${photos.length} photos` : 'Send the photo'}</VisitButton>
      </section>
    </VisitCard>);
}

/** The thank-you once they've sent (it stays while they're on the page). */
export const PhotosSentCard = ({ text }: { text: string }) => <VisitCard tone="ok"><p className="text-[15px]" role="status">{text}</p></VisitCard>;
