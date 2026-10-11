'use client';
// src/app/(app)/settings/aftercare/page.tsx — SETTINGS → AFTERCARE (approved design, canvas row 24): what clients get
// after a visit (tenant.aftercare, read through lib/aftercare aftercareSettingsOf). Whether it's sent at all; right after
// checkout or with the thank-you the next day; a one-tap check-in a few days later; whether to show what was used and the
// provider's note. The aftercare itself is written in Documents → Client aftercare.
import * as React from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { SettingsPage, Section, Row, Toggle, Choice } from '@/components/settings/settings-ui';
import { aftercareSettingsOf, type AftercareSettings, type CareWhen } from '@/lib/aftercare';

export default function AftercareSettingsPage() {
  const { selectedTenant, role } = useTenant() as any; const { firestore } = useFirebase(); const { toast } = useToast();
  const tenantId = selectedTenant?.id || ''; const canEdit = String(role || '').toLowerCase() === 'owner';
  const [s, setS] = React.useState<AftercareSettings | null>(null); const [dirty, setDirty] = React.useState(false); const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (selectedTenant && !s) setS(aftercareSettingsOf(selectedTenant)); }, [selectedTenant, s]);
  if (!s) return <SettingsPage title="Aftercare"><p className="cf-muted">Loading…</p></SettingsPage>;
  const set = (p: Partial<AftercareSettings>) => { if (!canEdit) return; setS({ ...s, ...p }); setDirty(true); };
  const save = async () => {
    if (!firestore || !tenantId) return; setSaving(true);
    try { await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}`), { aftercare: s }); setDirty(false); toast({ title: 'Aftercare saved' }); }
    catch { toast({ title: 'That didn’t save', description: 'Check your connection and try again.', variant: 'destructive' }); }
    setSaving(false);
  };
  return (
    <SettingsPage title="Aftercare" help={<>What clients get after a visit. You write the aftercare itself in <a href="/documents" className="underline underline-offset-2">Documents → Client aftercare</a> — one for a service, or one for everything.</>}
      actions={canEdit ? <button type="button" disabled={!dirty || saving} onClick={save} className="h-11 rounded-full px-5 text-[14.5px] font-semibold text-white disabled:opacity-40" style={{ background: '#16171a' }}>{saving ? 'Saving…' : 'Save'}</button> : null}>
      {!canEdit && <p className="text-[14px] cf-muted">Only the owner can change these.</p>}
      <Section title="Sending">
        <div className="cf-sheet">
          <Row label="Send aftercare" help="Off: nothing is sent, and the visit pages don’t show it." inline><Toggle checked={s.on} onChange={(v) => set({ on: v })} label="Send aftercare" disabled={!canEdit} /></Row>
          {s.on && <Row label="When" help="Right after checkout is best — the first hours matter most. It goes about ten minutes after, so the provider can still add a note." inline>
            <Choice<CareWhen> value={s.when} label="When" onChange={(v) => set({ when: v })} options={[{ value: 'checkout', label: 'At checkout' }, { value: 'next_day', label: 'Next day, with the thank-you' }]} /></Row>}
          {s.on && <Row label="Check in after" help="A one-tap “How is it holding up?” text. An aftercare document can choose its own day." inline>
            <Choice<number> value={s.checkInDays} label="Check in after" onChange={(v) => set({ checkInDays: v })} options={[{ value: 0, label: 'Off' }, { value: 2, label: '2 days' }, { value: 3, label: '3 days' }, { value: 7, label: '7 days' }]} /></Row>}
        </div>
      </Section>
      {s.on && <Section title="On the client’s page">
        <div className="cf-sheet">
          <Row label="Show what we used" help="The products recorded at checkout (name, shade, batch) — useful if a client reacts to something." inline><Toggle checked={s.showProducts} onChange={(v) => set({ showProducts: v })} label="Show what we used" disabled={!canEdit} /></Row>
          <Row label="Provider’s note" help="The provider can add a line for this client from the staff app; it shows at the top." inline><Toggle checked={s.providerNote} onChange={(v) => set({ providerNote: v })} label="Provider’s note" disabled={!canEdit} /></Row>
          <Row label="Book again" help="The button uses each service’s rebook time (Services → the service → Rebook every)." inline><span className="text-[14px] cf-muted">From each service</span></Row>
        </div>
      </Section>}
      <Section title="Renters"><div className="cf-sheet"><Row label="Their own choice" help="Renters set their own aftercare in their portal. Yours is never sent for their clients." inline><span /></Row></div></Section>
    </SettingsPage>);
}
