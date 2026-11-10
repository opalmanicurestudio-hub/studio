'use client';
// components/renters/RenterEditDialog.tsx — ONE EDIT FOR A RENTER. Their name, email, phone, what they do and their
// business name, from the Renters list or their own page. When they take bookings, the provider record the booking page
// shows is updated in the same save (lib/renter-identity), so they're never listed under a name nobody uses any more.
import * as React from 'react';
import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { staffMirrorFields, mirrorDiffers } from '@/lib/renter-identity';

const input = 'mt-1 h-11 w-full rounded-xl border border-[#ececee] bg-white px-3 text-[15px] text-[#16171a]';
const btn = 'inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#ececee] bg-white px-4 text-[15px] font-medium text-[#16171a] hover:bg-[#f5f5f7] disabled:opacity-40';
const dark = 'inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#16171a] px-4 text-[15px] font-semibold text-white disabled:opacity-40';
const FIELDS: [string, string, string][] = [['firstName', 'First name', 'given-name'], ['lastName', 'Last name', 'family-name'], ['email', 'Email', 'email'], ['phone', 'Phone', 'tel'], ['specialty', 'What they do', 'off'], ['businessName', 'Business name', 'organization']];

export function RenterEditDialog({ tenantId, firestore, renter, onClose, onSaved }: {
  tenantId: string; firestore: any; renter: any; onClose: () => void; onSaved?: (said: string) => void;
}) {
  const [f, setF] = React.useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map(([k]) => [k, String(renter?.[k] || '')])));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const titleId = React.useId();
  React.useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [busy, onClose]);
  // Focus goes back where it was when the dialog closes (it starts on the first field).
  React.useEffect(() => { const was = document.activeElement as HTMLElement | null; return () => { try { was?.focus(); } catch { /* gone */ } }; }, []);
  const save = async () => {
    if (busy) return;
    if (!f.firstName.trim() && !f.lastName.trim()) { setErr('Give them a name.'); return; }
    setBusy(true); setErr('');
    try {
      const next = Object.fromEntries(FIELDS.map(([k]) => [k, f[k].trim()]));
      await updateDoc(doc(firestore, 'tenants', tenantId, 'renters', renter.id), { ...next, updatedAt: new Date().toISOString() });
      const prov = (await getDocs(query(collection(firestore, 'tenants', tenantId, 'staff'), where('renterId', '==', renter.id)))).docs.map((d) => ({ id: d.id, ...(d.data() as any) })).find((x) => x.isRenter);
      if (prov) { const mirror = staffMirrorFields({ ...renter, ...next, photoUrl: undefined }); if (mirrorDiffers(mirror, prov)) await updateDoc(doc(firestore, 'tenants', tenantId, 'staff', prov.id), mirror); }
      onSaved?.(prov ? 'Saved. Their booking page shows the change too.' : 'Saved.');
      onClose();
    } catch { setErr('That didn’t save. Try again.'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-[20px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId} className="text-[19px] font-bold leading-7 text-[#16171a]">Edit {`${renter?.firstName || ''} ${renter?.lastName || ''}`.trim() || 'renter'}</h2>
        {FIELDS.map(([k, label, auto]) => (
          <label key={k} className="block">
            <span className="text-[13px] font-medium text-[#16171a]">{label}</span>
            <input autoFocus={k === 'firstName'} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} autoComplete={auto} type={k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text'} className={input} />
          </label>
        ))}
        {err && <p role="alert" className="text-[14px] text-[#b45309]">{err}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" className={btn} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={dark} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
