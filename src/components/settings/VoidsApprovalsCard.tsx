'use client';
// src/components/settings/VoidsApprovalsCard.tsx — VOIDS AND APPROVALS (Settings → Payments). Saves as you go.
import * as React from 'react';
import { collection, doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';

export function VoidsApprovalsCard({ tenantId, tenant, canEdit }: { tenantId: string; tenant: any; canEdit: boolean }) {
  const { firestore } = useFirebase() as any;
  const [win, setWin] = React.useState<string>(tenant?.voidRules?.window === 'till_open' ? 'till_open' : 'same_day');
  const [phone, setPhone] = React.useState<boolean>(tenant?.approvalRules?.phoneApproval !== false);
  const [sdLimit, setSdLimit] = React.useState<number>(Number.isFinite(Number(tenant?.approvalRules?.staffDiscountLimitPct)) && tenant?.approvalRules?.staffDiscountLimitPct !== undefined ? Number(tenant.approvalRules.staffDiscountLimitPct) : 10);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [via, setVia] = React.useState<string>(['text', 'email', 'both'].includes(tenant?.approvalRules?.remoteChannel) ? tenant.approvalRules.remoteChannel : 'both');
  const [who, setWho] = React.useState<string[]>(Array.isArray(tenant?.approvalRules?.remoteApproverIds) ? tenant.approvalRules.remoteApproverIds : []);
  const sq = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, `tenants/${tenantId}/staff`) : null), [firestore, tenantId]);
  const { data: staff } = useCollection<any>(sq);
  const approvers = (staff || []).filter((m: any) => ['owner', 'admin', 'manager'].includes(String(m.role || '').toLowerCase()) && m.isActive !== false);
  const save = async (patch: any) => { setMsg(null); try { await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), patch); setMsg('Saved.'); } catch (e: any) { setMsg(e?.message || 'Couldn’t save.'); } };
  const Pill = ({ on, onClick, children }: any) => <button type="button" disabled={!canEdit} aria-pressed={on} onClick={onClick} className={`rounded-full border px-4 py-1.5 text-sm ${on ? 'bg-slate-900 text-white' : 'bg-white'}`}>{children}</button>;
  return (
    <div className="space-y-4 rounded-[2rem] border-2 bg-white p-6">
      <div><p className="text-lg font-semibold">Voids and approvals</p>
        <p className="text-sm text-muted-foreground">A manager approves voids, fee waivers, and service recovery over your limit — by signing in, entering their PIN (checked securely), or from their phone. Who asked, who approved and why are recorded on the sale and in the activity log.</p></div>
      <div className="space-y-2 text-sm"><p className="font-semibold">A whole sale can be voided</p>
        <div className="flex flex-wrap gap-2"><Pill on={win === 'same_day'} onClick={() => { setWin('same_day'); save({ 'voidRules.window': 'same_day' }); }}>On the same day</Pill><Pill on={win === 'till_open'} onClick={() => { setWin('till_open'); save({ 'voidRules.window': 'till_open' }); }}>Until that day’s till is closed</Pill></div>
        <p className="text-xs text-muted-foreground">After that, refund it instead. Voids undo the whole sale — card refunded or cash handed back, stock, fees, deposit credit and the till all put right.</p></div>
      <div className="space-y-2 text-sm"><p className="font-semibold">Staff discounts without a manager</p>
        <div className="flex flex-wrap gap-2">{[0, 5, 10, 15, 20].map((n) => <Pill key={n} on={sdLimit === n} onClick={() => { setSdLimit(n); save({ 'approvalRules.staffDiscountLimitPct': n }); }}>{n === 0 ? 'Always ask a manager' : `Up to ${n}%`}</Pill>)}</div>
        <p className="text-xs text-muted-foreground">Staff give discounts with a reason — never by changing a price. Above this, a manager approves. Managers aren’t limited.</p></div>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={phone} disabled={!canEdit} onChange={(e) => { setPhone(e.target.checked); save({ 'approvalRules.phoneApproval': e.target.checked }); }} />
        <span><b>Managers can approve from their phone</b> <span className="text-muted-foreground">— the desk can ask, and the manager taps Approve or Decline.</span></span></label>
      {phone && <div className="space-y-3 rounded-2xl bg-slate-50 p-4 text-sm">
        <div className="space-y-2"><p className="font-semibold">Remote requests are sent by</p>
          <div className="flex flex-wrap gap-2">{([['both', 'Text and email'], ['text', 'Text'], ['email', 'Email']] as const).map(([v, l]) => <Pill key={v} on={via === v} onClick={() => { setVia(v); save({ 'approvalRules.remoteChannel': v }); }}>{l}</Pill>)}</div>
          <p className="text-xs text-muted-foreground">They open a page, enter their own PIN, and tap Approve or Decline — it’s recorded in their name. Requests expire after 15 minutes.</p></div>
        <div className="space-y-2"><p className="font-semibold">Who’s asked</p>
          <label className="flex items-center gap-2"><input type="checkbox" checked={!who.length} disabled={!canEdit} onChange={() => { setWho([]); save({ 'approvalRules.remoteApproverIds': [] }); }} /> Everyone who can approve</label>
          {approvers.map((m: any) => <label key={m.id} className="flex items-center gap-2 pl-5"><input type="checkbox" checked={who.includes(m.id)} disabled={!canEdit}
            onChange={(e) => { const next = e.target.checked ? [...who, m.id] : who.filter((x) => x !== m.id); setWho(next); save({ 'approvalRules.remoteApproverIds': next }); }} />
            {m.name}<span className="text-xs text-muted-foreground">{!m.phone && !m.email ? ' — no phone or email on file' : !m.phone && via !== 'email' ? ' — no mobile on file' : !m.email && via !== 'text' ? ' — no email on file' : ''}</span></label>)}
        </div>
      </div>}
      <p className="text-xs text-muted-foreground">Service recovery limits are set under Service recovery.</p>
      {msg && <p className="text-sm font-semibold">{msg}</p>}
    </div>
  );
}
