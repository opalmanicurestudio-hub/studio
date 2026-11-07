'use client';
// src/components/markup/useTeamPhoto.ts — ONE OF A CLIENT'S INSPIRATION PHOTOS, OPENED FOR THE TEAM (boards 17C, 18D):
// the photo itself, through this app (api/visit-photos "bytes", so it can be drawn on in the browser) — the photo
// before the client's marks when it was kept, else the photo as sent — and the team's marks on it so far, put together
// with the client's (lib/markup/team). Used by the markup tool (TeamPhotoMarkup) and a photo's record on the client's
// page (ClientPhotoRecord). Each photo it makes a link for is let go of when it's done with.
import * as React from 'react';
import type { MarkupDoc, Mark } from '@/lib/markup/model';
import { photoKey, teamDocFor, type TeamBase } from '@/lib/markup/team';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { resolvePrivateUrl } from '@/components/shared/private-file';

export type TeamPhoto = { src: string; base: TeamBase; doc: MarkupDoc | null; clientColors: string[]; clientMarks: Mark[]; cut: boolean; dropped: boolean; note: string; sentAt: string | null; direct: boolean };

export function useTeamPhoto(tenantId: string, apptId: string, photo: any): { ready: TeamPhoto | 'loading' | { error: string }; call: (body: any) => Promise<Response> } {
  const key = photoKey(String(photo?.url || ''));
  const [ready, setReady] = React.useState<TeamPhoto | 'loading' | { error: string }>('loading');
  const made = React.useRef<string[]>([]);
  const call = async (body: any) => fetch('/api/visit-photos', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, apptId, key, ...body }) });
  React.useEffect(() => {
    let gone = false; setReady('loading');
    (async () => {
      const bytes = async (which: 'original' | 'photo') => { try { const r = await call({ action: 'bytes', which }); if (!r.ok) return null; const b = await r.blob(); if (!b.size || !/^image\//.test(b.type)) return null; const u = URL.createObjectURL(b); if (gone) { URL.revokeObjectURL(u); return null; } made.current.push(u); return u; } catch { return null; } };
      const [kept, orig] = await Promise.all([
        call({ action: 'load' }).then((r) => r.json()).catch(() => null),
        photo?.original ? bytes('original') : Promise.resolve(null)]);
      if (gone) return;
      let src = orig; const base: TeamBase = orig ? 'original' : 'photo'; let direct = false;
      if (!src) src = await bytes('photo');
      // Older photos from elsewhere: opened as they are (they may only be looked at, if that site won't share them).
      if (!src) { try { src = await resolvePrivateUrl(String(photo.url)); direct = true; } catch { src = null; } }
      if (gone) return;
      if (!src) { setReady({ error: 'This photo couldn’t be opened just now. Please try again.' }); return; }
      const mark = kept?.ok ? kept.mark : null;
      const t = teamDocFor({ client: photo?.markup || null, team: mark?.markup || null, base, teamBase: mark ? mark.base : null });
      setReady({ src, base, doc: t.doc, clientColors: t.clientColors, clientMarks: t.clientMarks, cut: t.cut, dropped: t.dropped, note: t.dropped ? '' : String(mark?.note || ''), sentAt: mark?.sentAt || null, direct });
    })();
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, apptId]);
  React.useEffect(() => () => { made.current.forEach((u) => URL.revokeObjectURL(u)); }, []);
  return { ready, call };
}
