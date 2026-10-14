'use client';
// src/components/making-it-right/AfterPhoto.tsx — AFTER PHOTO at the end of a visit, for the services the business chose
// (Settings → Making it right). Fair evidence for both sides if there's a complaint later — the work as it left. Saved on
// the visit (afterPhotoUrls). When the business requires it, finishing waits for one.
import * as React from 'react';
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { settingsOf } from '@/lib/making-it-right';
import { shrink } from '@/components/making-it-right/VoiceNote';

export function AfterPhoto({ firestore, tenantId, appointment, serviceIds, onRequiredMissing }: { firestore: any; tenantId: string; appointment: any; serviceIds: string[]; onRequiredMissing: (missing: boolean) => void }) {
  const [rule, setRule] = React.useState<{ on: boolean; required: boolean } | null>(null); const [urls, setUrls] = React.useState<string[]>(appointment?.afterPhotoUrls || []); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  React.useEffect(() => { if (!firestore || !tenantId) return; getDoc(doc(firestore, `tenants/${tenantId}`)).then((d) => { const S = settingsOf(d.data() || {}); const on = !!(d.data() as any)?.makingItRight && serviceIds.some((id) => S.afterPhotos.services.includes(id)); setRule({ on, required: on && S.afterPhotos.required }); }).catch(() => setRule({ on: false, required: false })); }, [firestore, tenantId, serviceIds.join(',')]);   // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { onRequiredMissing(!!rule?.required && urls.length === 0); }, [rule, urls.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!rule?.on) return null;
  const add = async (files: FileList | null) => {
    if (!files?.length) return; setBusy(true); setErr('');
    try { const form = new FormData(); for (const f of Array.from(files).slice(0, 4)) form.append('files', new File([await (await fetch(await shrink(f))).blob()], 'after.jpg', { type: 'image/jpeg' }));
      form.append('tenantId', tenantId); form.append('appointmentId', appointment.id);
      const tk = await getAuth().currentUser?.getIdToken().catch(() => '');
      const r = await fetch('/api/upload/appointment-photos', { method: 'POST', body: form, headers: tk ? { Authorization: `Bearer ${tk}` } : {} }).then((x) => x.json()).catch(() => ({}));
      if (!r.urls?.length) throw new Error(r.error || 'That photo didn’t upload.');
      await updateDoc(doc(firestore, `tenants/${tenantId}/appointments/${appointment.id}`), { afterPhotoUrls: arrayUnion(...r.urls) }); setUrls((u) => [...u, ...r.urls]);
    } catch (e: any) { setErr(e.message || 'That photo didn’t upload.'); }
    setBusy(false);
  };
  return (
    <div className="space-y-2 rounded-2xl border-2 p-3" style={{ borderColor: rule.required && !urls.length ? '#e7b04f' : '#ececee' }}>
      <p className="text-[14px] font-bold">After photo{rule.required ? '' : ' (optional)'}</p>
      <p className="text-[12.5px] text-muted-foreground">The work as it leaves — it protects you and the client if there’s a question later.</p>
      <div className="flex flex-wrap gap-2">{urls.map((u) => <img key={u} src={u} alt="After" className="h-16 w-16 rounded-xl object-cover" />)}
        <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed text-[22px] text-muted-foreground">{busy ? '…' : '+'}<input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => add(e.target.files)} /></label></div>
      {err && <p className="text-[12.5px] font-semibold text-rose-700">{err}</p>}
    </div>);
}
