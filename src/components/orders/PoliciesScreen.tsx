'use client';
// src/components/orders/PoliciesScreen.tsx — EVERY SHOP POLICY ON ONE SCREEN. Cancelling, returns, restocking fees by
// condition, problem reports, refunds and the wording customers see. Each change saves on its own path the moment it's
// made, so nothing here can overwrite a setting changed somewhere else. Managers change them; everyone else can read.
import * as React from 'react';
import Link from 'next/link';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { FEE_BANDS, type FeeBand } from '@/lib/restocking';
import { C, Group, LargeTitle, Row, Seg, Toggle, UndoBar, muted, Ic } from './ui';

function NumberField({ value, unit, prefix, label, onSave, disabled, max }: { value: number; unit?: string; prefix?: string; label: string; onSave: (n: number) => void; disabled?: boolean; max?: number }) {
  const [v, setV] = React.useState(String(value));
  React.useEffect(() => { setV(String(value)); }, [value]);
  const commit = () => { let n = Number(v.replace(/[^0-9.]/g, '')) || 0; if (max != null) n = Math.min(max, n); if (n !== value) onSave(n); setV(String(n)); };
  return (
    <label className="flex h-10 shrink-0 items-center gap-1 rounded-xl px-3" style={{ background: C.paper }}>
      {prefix ? <span className="text-[17px]" style={muted}>{prefix}</span> : null}
      <input inputMode="decimal" aria-label={label} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-14 border-0 bg-transparent text-right text-[17px] outline-none ring-0 focus:ring-0 disabled:opacity-60" />
      {unit ? <span className="text-[15px]" style={muted}>{unit}</span> : null}
    </label>);
}

export function PoliciesScreen() {
  const { firestore } = useFirebase() as any; const fs = firestore as Firestore;
  const { selectedTenant, role } = useTenant() as any;
  const tenantId = String(selectedTenant?.id || '');
  const rs = (selectedTenant?.retailSettings || {}) as any;
  const pol = (rs.policies || {}) as any;
  const canEdit = ['owner', 'admin', 'manager'].includes(String(role || '').toLowerCase());
  const [toast, setToast] = React.useState('');
  const [wording, setWording] = React.useState<string>(rs.returnPolicyText || '');
  React.useEffect(() => { setWording(rs.returnPolicyText || ''); }, [rs.returnPolicyText]);

  const save = async (path: string, value: any, what: string) => {
    if (!canEdit || !fs || !tenantId) return;
    try { await updateDoc(doc(fs, 'tenants', tenantId), { [path]: value }); setToast(`${what} saved`); }
    catch { setToast(`${what} didn’t save. Try again.`); }
  };
  const fees = pol.restockingFees && typeof pol.restockingFees === 'object' ? pol.restockingFees : null;
  const oldPct = Math.max(0, Number(pol.restockingFeePct) || 0);
  const feeOf = (b: FeeBand) => (fees ? Math.max(0, Number(fees[b]) || 0) : oldPct);
  const setFee = (b: FeeBand, n: number) => {
    const next = { as_new: feeOf('as_new'), opened: feeOf('opened'), damaged: feeOf('damaged'), [b]: Math.min(50, Math.floor(n)) };
    void save('retailSettings.policies.restockingFees', next, 'Restocking fee');
  };
  const dollars = (c: unknown) => Math.round(Math.max(0, Number(c) || 0)) / 100;
  const payer = rs.returnLabelPayer === 'shop' || rs.returnLabelPayer === 'customer' ? rs.returnLabelPayer : 'fault';
  const returnsOn = rs.returnsEnabled !== false;

  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-2xl px-4 pt-3">
        <Link href="/retail-orders/setup" className="inline-flex h-11 items-center gap-1 text-[17px]" style={{ color: C.ink }}>{Ic.back}Setup</Link>
        <LargeTitle title="Policies" sub={canEdit ? 'Changes save as you make them.' : 'Only a manager can change these.'} />

        <Group title="Cancelling" foot="If an order misses its promised time, the customer can always cancel, whatever this says.">
          <Row label="Customers can cancel online"><Toggle label="Customers can cancel online" on={pol.cancelAllowed !== false} disabled={!canEdit} onChange={(v) => void save('retailSettings.policies.cancelAllowed', v, 'Cancelling')} /></Row>
          <Row label="Up to" note="Hours after paying. 0 means until packing starts." last><NumberField label="Cancel window in hours" value={Number(pol.cancelWindowHours) || 0} unit="hours" disabled={!canEdit} onSave={(n) => void save('retailSettings.policies.cancelWindowHours', Math.floor(n), 'Cancel window')} /></Row>
        </Group>

        <Group title="Returns" foot="Problems like damage or a wrong item can always be reported, even with returns off.">
          <Row label="Accept returns"><Toggle label="Accept returns" on={returnsOn} disabled={!canEdit} onChange={(v) => void save('retailSettings.returnsEnabled', v, 'Returns')} /></Row>
          {returnsOn && <Row label="Return window" note="Days after delivery. 0 means no limit."><NumberField label="Return window in days" value={Number(rs.returnWindowDays) || 0} unit="days" disabled={!canEdit} onSave={(n) => void save('retailSettings.returnWindowDays', Math.floor(n), 'Return window')} /></Row>}
          {returnsOn && (
            <div className="px-4 py-3">
              <p className="m-0 text-[17px]">Who pays return shipping</p>
              <div className="mt-2.5"><Seg value={payer} onChange={(v) => void save('retailSettings.returnLabelPayer', v, 'Return shipping')} options={[{ id: 'fault', label: 'By fault' }, { id: 'shop', label: 'Shop' }, { id: 'customer', label: 'Customer' }]} /></div>
              <p className="m-0 mt-2 text-[13px]" style={muted}>{payer === 'fault' ? 'The shop pays for defects and wrong items. The customer pays when they changed their mind.' : payer === 'shop' ? 'Every return label is on the shop.' : 'The label cost comes off the customer’s refund.'}</p>
            </div>)}
        </Group>

        {returnsOn && (
          <Group title="Restocking fee" foot="A share of the item price, never tax or shipping. Refunds only, and never when anything on the return was the shop’s fault. Up to 50%.">
            {FEE_BANDS.map((b, i) => (
              <Row key={b.id} label={b.label} note={b.note} last={i === FEE_BANDS.length - 1}><NumberField label={`${b.label} fee`} value={feeOf(b.id)} unit="%" max={50} disabled={!canEdit} onSave={(n) => setFee(b.id, n)} /></Row>))}
          </Group>)}

        <Group title="Problem reports">
          <Row label="Report within" note="Days after delivery to report missing, damaged or wrong items. 0 means no limit."><NumberField label="Report window in days" value={Number(rs.deliveryIssueWindowDays) || 0} unit="days" disabled={!canEdit} onSave={(n) => void save('retailSettings.deliveryIssueWindowDays', Math.floor(n), 'Report window')} /></Row>
          <Row label="Approve small claims on their own" note="Up to this amount, when your packing record agrees and the customer is low risk. $0 means you decide every one."><NumberField label="Auto-approve up to" prefix="$" value={dollars(rs.claimAutoResolveMaxCents)} disabled={!canEdit} onSave={(n) => void save('retailSettings.claimAutoResolveMaxCents', Math.round(n * 100), 'Claim limit')} /></Row>
          <Row label="Always review after" note="Prior claims from the same email. 0 means off."><NumberField label="Review after claims" value={Number(pol.claimReviewAfter) || 0} unit="claims" disabled={!canEdit} onSave={(n) => void save('retailSettings.policies.claimReviewAfter', Math.floor(n), 'Review threshold')} /></Row>
          <Row label="Photo needed for damage or wrong item" note="Approving waits for the customer’s photo." last><Toggle label="Photo needed" on={pol.claimPhotosRequired === true} disabled={!canEdit} onChange={(v) => void save('retailSettings.policies.claimPhotosRequired', v, 'Photo rule')} /></Row>
        </Group>

        <Group title="Refunds and credit">
          <Row label="Refund on its own up to" note="Smaller refunds go back to the card as soon as a return is checked in. $0 means you confirm every one."><NumberField label="Refund on its own up to" prefix="$" value={dollars(pol.refundAutoBelowCents)} disabled={!canEdit} onSave={(n) => void save('retailSettings.policies.refundAutoBelowCents', Math.round(n * 100), 'Refund limit')} /></Row>
          <Row label="Staff can give store credit up to" note="Managers have no limit." last><NumberField label="Staff credit limit" prefix="$" value={dollars(rs.staffCreditCapCents ?? 2500)} disabled={!canEdit} onSave={(n) => void save('retailSettings.staffCreditCapCents', Math.round(n * 100), 'Credit limit')} /></Row>
        </Group>

        <Group title="What customers read" foot="Shown at checkout, on the card in every box, and in the record if a payment is disputed. Each order keeps the wording it was placed under.">
          <textarea aria-label="Return policy wording" value={wording} disabled={!canEdit} onChange={(e) => setWording(e.target.value.slice(0, 1200))} onBlur={() => { if (wording.trim() !== String(rs.returnPolicyText || '').trim()) void save('retailSettings.returnPolicyText', wording.trim(), 'Wording'); }}
            placeholder="Leave blank and it’s written from the settings above." rows={4} className="block w-full resize-y border-0 bg-transparent px-4 py-3 text-[17px] outline-none ring-0 focus:ring-0" />
        </Group>
      </div>
      {toast && <UndoBar text={toast} onDone={() => setToast('')} bottom={32} />}
    </div>);
}
