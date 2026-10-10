'use client';
// src/components/staff-portal/MyDetails.tsx — A TEAM MEMBER KEEPS THEIR OWN DETAILS UP TO DATE (portal → Me → My details):
// what they like to be called, pronouns, phone, address, emergency contact, a short bio. Only these fields — the
// database rules refuse anything else (pay, role, PIN). Managers get a note saying what changed.
import * as React from 'react';
import { doc, updateDoc, collection, setDoc } from 'firebase/firestore';
import { useDoc, useMemoFirebase } from '@/firebase';

const INK = '#16171a', MUTED = '#6d7075';
const FIELDS: { k: string; label: string; type?: string; auto?: string; area?: boolean }[] = [
  { k: 'preferredName', label: 'What you like to be called' }, { k: 'pronouns', label: 'Pronouns' },
  { k: 'phone', label: 'Mobile number', type: 'tel', auto: 'tel' }, { k: 'address', label: 'Home address', auto: 'street-address' },
  { k: 'ec.name', label: 'Emergency contact — name' }, { k: 'ec.relationship', label: 'Emergency contact — who they are to you' },
  { k: 'ec.phone', label: 'Emergency contact — phone', type: 'tel' }, { k: 'bio', label: 'A line about you (shown to clients)', area: true },
];
const LABEL: Record<string, string> = { preferredName: 'preferred name', pronouns: 'pronouns', phone: 'phone number', address: 'address', emergencyContact: 'emergency contact', bio: 'bio' };

export function MyDetails({ firestore, tenantId, staffId, name, managerIds, onDone }: { firestore: any; tenantId: string; staffId: string; name: string; managerIds: string[]; onDone: () => void }) {
  const ref = useMemoFirebase(() => (!firestore || !tenantId || !staffId) ? null : doc(firestore, `tenants/${tenantId}/staff/${staffId}`), [firestore, tenantId, staffId]);
  const { data } = useDoc<any>(ref);
  const [v, setV] = React.useState<Record<string, string>>({}); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const loaded = React.useRef(false);
  React.useEffect(() => { if (!data || loaded.current) return; loaded.current = true; const ec = data.emergencyContact || {};
    setV({ preferredName: data.preferredName || '', pronouns: data.pronouns || '', phone: data.phone || data.phoneNumber || '', address: typeof data.address === 'string' ? data.address : '', 'ec.name': ec.name || '', 'ec.relationship': ec.relationship || '', 'ec.phone': ec.phone || '', bio: data.bio || '' }); }, [data]);
  const save = async () => {
    if (!data) return; setBusy(true); setErr('');
    try {
      const patch: any = { preferredName: v.preferredName.trim(), pronouns: v.pronouns.trim(), phone: v.phone.trim(), address: v.address.trim(), bio: v.bio.trim().slice(0, 400),
        emergencyContact: { name: v['ec.name'].trim(), relationship: v['ec.relationship'].trim(), phone: v['ec.phone'].trim() } };
      const ec0 = data.emergencyContact || {};
      const was: any = { preferredName: data.preferredName || '', pronouns: data.pronouns || '', phone: data.phone || data.phoneNumber || '', address: typeof data.address === 'string' ? data.address : '', bio: data.bio || '',
        emergencyContact: JSON.stringify({ name: ec0.name || '', relationship: ec0.relationship || '', phone: ec0.phone || '' }) };
      const changed = Object.keys(patch).filter((k) => (k === 'emergencyContact' ? JSON.stringify(patch[k]) !== was[k] : patch[k] !== was[k]));
      if (!changed.length) { onDone(); return; }
      const now = new Date().toISOString();
      await updateDoc(ref as any, { ...Object.fromEntries(changed.map((k) => [k, patch[k]])), updatedAt: now });
      if (changed.some((k) => k !== 'bio' && k !== 'pronouns' && k !== 'preferredName')) for (const m of managerIds.filter((id) => id !== staffId)) {
        const n = doc(collection(firestore, `tenants/${tenantId}/notifications`));
        await setDoc(n, { id: n.id, userId: m, type: 'staff_details', message: `${name} updated their ${changed.map((k) => LABEL[k]).join(', ')}.`, link: '/staff', createdAt: now, read: false }).catch(() => {});
      }
      onDone();
    } catch { setErr('That didn’t save — check your connection and try again.'); }
    finally { setBusy(false); }
  };
  return (
    <section aria-label="My details" className="space-y-3 rounded-[24px] border border-[#ececee] bg-white p-4" style={{ color: INK }}>
      <div><p className="text-[18px] font-extrabold">My details</p><p className="text-[13px]" style={{ color: MUTED }}>Your manager is told when your phone, address or emergency contact changes.</p></div>
      {FIELDS.map((f) => (
        <label key={f.k} className="block space-y-1">
          <span className="text-[13px] font-semibold" style={{ color: '#55585e' }}>{f.label}</span>
          {f.area ? <textarea value={v[f.k] || ''} onChange={(e) => setV((x) => ({ ...x, [f.k]: e.target.value }))} rows={3} maxLength={400} className="w-full rounded-[14px] border border-[#e6e6e8] px-3 py-2 text-[16px]" />
            : <input value={v[f.k] || ''} type={f.type || 'text'} autoComplete={f.auto} inputMode={f.type === 'tel' ? 'tel' : undefined} onChange={(e) => setV((x) => ({ ...x, [f.k]: e.target.value }))} className="h-12 w-full rounded-[14px] border border-[#e6e6e8] px-3 text-[16px]" />}
        </label>))}
      {err && <p role="alert" className="text-[13px] font-medium text-[#b42318]">{err}</p>}
      <div className="flex gap-2 pt-1">
        <button type="button" disabled={busy || !data} onClick={save} className="h-12 flex-1 rounded-[16px] text-[16px] font-bold text-white disabled:opacity-50" style={{ background: INK }}>Save</button>
        <button type="button" onClick={onDone} className="h-12 rounded-[16px] border border-[#e6e6e8] px-5 text-[15px] font-semibold">Cancel</button>
      </div>
    </section>);
}
