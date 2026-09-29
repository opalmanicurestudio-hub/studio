'use client';
// src/components/settings/VoidsApprovalsCard.tsx — VOIDS AND APPROVALS (Settings → Payments). Saves as you go.
import * as React from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';

export function VoidsApprovalsCard({ tenantId, tenant, canEdit }: { tenantId: string; tenant: any; canEdit: boolean }) {
  const { firestore } = useFirebase() as any;
  const [win, setWin] = React.useState<string>(tenant?.voidRules?.window === 'till_open' ? 'till_open' : 'same_day');
  const [phone, setPhone] = React.useState<boolean>(tenant?.approvalRules?.phoneApproval !== false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const save = async (patch: any) => { setMsg(null); try { await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), patch); setMsg('Saved.'); } catch (e: any) { setMsg(e?.message || 'Couldn’t save.'); } };
  const Pill = ({ on, onClick, children }: any) => <button type="button" disabled={!canEdit} aria-pressed={on} onClick={onClick} className={`rounded-full border px-4 py-1.5 text-sm ${on ? 'bg-slate-900 text-white' : 'bg-white'}`}>{children}</button>;
  return (
    <div className="space-y-4 rounded-[2rem] border-2 bg-white p-6">
      <div><p className="text-lg font-semibold">Voids and approvals</p>
        <p className="text-sm text-muted-foreground">A manager approves voids, fee waivers, and service recovery over your limit — by signing in, entering their PIN (checked securely), or from their phone. Who asked, who approved and why are recorded on the sale and in the activity log.</p></div>
      <div className="space-y-2 text-sm"><p className="font-semibold">A whole sale can be voided</p>
        <div className="flex flex-wrap gap-2"><Pill on={win === 'same_day'} onClick={() => { setWin('same_day'); save({ 'voidRules.window': 'same_day' }); }}>On the same day</Pill><Pill on={win === 'till_open'} onClick={() => { setWin('till_open'); save({ 'voidRules.window': 'till_open' }); }}>Until that day’s till is closed</Pill></div>
        <p className="text-xs text-muted-foreground">After that, refund it instead. Voids undo the whole sale — card refunded or cash handed back, stock, fees, deposit credit and the till all put right.</p></div>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={phone} disabled={!canEdit} onChange={(e) => { setPhone(e.target.checked); save({ 'approvalRules.phoneApproval': e.target.checked }); }} />
        <span><b>Managers can approve from their phone</b> <span className="text-muted-foreground">— the desk can ask, and the manager taps Approve or Decline.</span></span></label>
      <p className="text-xs text-muted-foreground">Service recovery limits are set under Service recovery.</p>
      {msg && <p className="text-sm font-semibold">{msg}</p>}
    </div>
  );
}
