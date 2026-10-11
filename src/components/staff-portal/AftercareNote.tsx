'use client';
// src/components/staff-portal/AftercareNote.tsx — "AFTERCARE FOR KIM" in the staff app's visit drawer (approved design,
// canvas row 24 "finishing the visit"). Which aftercare this client will get and when, what was used (from checkout),
// and a line from the provider that shows at the top of the client's page (appointment.aftercareNote). Saved on the visit,
// so it still goes if the desk checks the client out first. Hidden when the business doesn't send aftercare.
import * as React from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { aftercareSettingsOf, aftercareDocFor, productsUsed, checkInDaysFor } from '@/lib/aftercare';
import { usePublishedDocs } from '@/components/staff-portal/VisitDocs';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', BLUE = '#3d5a99', GREEN = '#1f7a4d';

export function AftercareNote({ apt, tenantId, firestore, staffId, staffName }: { apt: any; tenantId: string; firestore: any; staffId: string; staffName?: string }) {
  const [tenant, setTenant] = React.useState<any>(null);
  React.useEffect(() => { let stop = false; if (firestore && tenantId) getDoc(doc(firestore, `tenants/${tenantId}`)).then((s) => { if (!stop) setTenant(s.data() || {}); }).catch(() => {}); return () => { stop = true; }; }, [firestore, tenantId]);
  const docs = usePublishedDocs(tenantId);
  const [text, setText] = React.useState<string>(String(apt?.aftercareNote?.text || '')); const [saved, setSaved] = React.useState(''); const [busy, setBusy] = React.useState(false);
  if (!tenant || !apt || apt.isRenterBooking) return null;
  const S = aftercareSettingsOf(tenant); if (!S.on) return null;
  const care = aftercareDocFor(docs, apt.serviceId, null); if (!care) return null;
  const first = String(apt.clientName || 'them').split(' ')[0];
  const sent = !!apt.aftercareSentAt; const days = checkInDaysFor(S, care);
  const used = S.showProducts ? productsUsed(apt) : [];
  const save = async () => {
    setBusy(true); setSaved('');
    try { await updateDoc(doc(firestore, `tenants/${tenantId}/appointments/${apt.id}`), { aftercareNote: { text: text.trim().slice(0, 400), by: staffId, byName: staffName || null, at: new Date().toISOString() } }); setSaved(sent ? 'Saved — it shows on the page they already have.' : 'Saved — it goes with the aftercare.'); }
    catch { setSaved('That didn’t save. Try again.'); }
    setBusy(false);
  };
  const page = apt.checkInToken ? `/aftercare/${tenantId}/${apt.id}?t=${encodeURIComponent(String(apt.checkInToken))}` : '';
  return (
    <div className="space-y-2.5 rounded-[18px] border bg-white p-3.5 text-left" style={{ borderColor: LINE, color: INK }}>
      <div className="flex items-center justify-between gap-2"><p className="text-[15.5px] font-semibold">Aftercare for {first}</p>
        <span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold" style={sent ? { background: '#e9f3ed', color: GREEN } : { background: '#e6ecf7', color: BLUE }}>{sent ? 'Sent' : S.when === 'checkout' ? 'Sends at checkout' : 'Sends tomorrow'}</span></div>
      <p className="text-[13px]" style={{ color: MUTED }}>“{care.title || 'Aftercare'}”{days ? ` · check-in after ${days} days` : ''}</p>
      {S.providerNote && <>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setSaved(''); }} rows={3} maxLength={400} placeholder={`A line just for ${first} (optional) — e.g. go easy on your left thumb this week.`} aria-label={`Note for ${first}`} className="w-full rounded-[14px] border bg-white px-3 py-2.5 text-[14.5px] leading-relaxed outline-none" style={{ borderColor: LINE }} />
        <p className="text-[12px]" style={{ color: MUTED }}>{saved || 'Your note shows at the top of their aftercare.'}</p></>}
      {used.length > 0 && <div><p className="pb-1 text-[12.5px]" style={{ color: MUTED }}>What you used (from checkout)</p><div className="flex flex-wrap gap-1.5">{used.map((u) => <span key={u} className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px]" style={{ background: SOFT }}>{u}</span>)}</div></div>}
      <div className="grid gap-2" style={{ gridTemplateColumns: page ? '1fr 1.3fr' : '1fr' }}>
        {page && <a href={page} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center rounded-full border bg-white text-[14px] font-medium" style={{ borderColor: LINE }}>Show {first}</a>}
        {S.providerNote && <button type="button" disabled={busy || text.trim() === String(apt?.aftercareNote?.text || '').trim()} onClick={save} className="h-11 rounded-full text-[14px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{busy ? 'Saving…' : 'Save note'}</button>}
      </div>
    </div>);
}
