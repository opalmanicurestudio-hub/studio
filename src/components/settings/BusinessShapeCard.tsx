'use client';
// src/components/settings/BusinessShapeCard.tsx — HOW YOUR BUSINESS WORKS (Settings → Business profile). What it does
// (lib/niche), whether one person sees every client or a team does, whether someone works a front desk, and whether the
// business keeps clients' health information. Each starts worked out (lib/business-shape) and the owner can say
// otherwise; messages and screens then
// fit: a one-person business is never told to "see the front desk", and a refund is "ready to pick up from Jessica".
// Saved as you choose (tenant.niche and tenant.shape, and privacy.healthMode, the same switch as Booking policies →
// Privacy).
import * as React from 'react';
import Link from 'next/link';
import { deleteField, doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { Section, Row, Toggle, Choice, cfInput, cfInputStyle } from '@/components/settings/settings-ui';
import { NICHES, nicheOf, nicheChosen } from '@/lib/niche';
import { useBusinessShape } from '@/hooks/use-business-shape';

export function BusinessShapeCard({ tenantId, tenant, canEdit }: { tenantId: string; tenant: any; canEdit: boolean }) {
  const { firestore } = useFirebase() as any;
  const b = useBusinessShape(tenantId, tenant);
  const [busy, setBusy] = React.useState<string | null>(null); const [said, setSaid] = React.useState<{ text: string; ok?: boolean } | null>(null);
  const save = async (field: string, value: any, words: string) => {
    if (!firestore || !canEdit) return;
    setBusy(field); setSaid(null);
    try { await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { [field]: value }); setSaid({ text: words, ok: true }); }
    catch { setSaid({ text: 'That didn’t save. Please try again.' }); }
    finally { setBusy(null); }
  };
  const n = b.providers;
  const worked = (what: string) => <span className="cf-muted"> {what}</span>;
  const reset = (field: string, label: string) => canEdit && <button type="button" disabled={!!busy} onClick={() => void save(field, deleteField(), `${label}: worked out for you again.`)} className="relative ml-1 underline underline-offset-2 after:absolute after:-inset-x-1 after:-inset-y-3 after:content-['']">Work it out for me</button>;
  const lock = canEdit ? '' : 'pointer-events-none opacity-50';
  return (
    <Section title="How your business works" help="So messages and screens fit how you work, such as who clients are told to see when they arrive.">
      <Row inline label="What you do" help={<>Examples, quick picks and tools to match: a barbershop is never asked about polish, and the nail guide only shows where nails are done.
        {!nicheChosen(tenant) ? worked('Worked out for you from your business’s details.') : <>{worked('You chose this.')}{reset('niche', 'What you do')}</>}</>}>
        <select value={nicheOf(tenant)} disabled={!canEdit || !!busy} aria-label="What you do" onChange={(e) => { const v = e.target.value; void save('niche', v, `Saved: ${(NICHES.find((x) => x.value === v)?.label || v).toLowerCase()}.`); }}
          className={`${cfInput} min-w-[13rem] disabled:opacity-50`} style={cfInputStyle}>
          {NICHES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>
      </Row>
      <Row inline label="Who sees clients" help={<>{b.solo ? 'Just you: the desk’s jobs come to you too.' : 'A team: work can pass between people.'}
        {b.guessed.solo ? worked(n != null ? `Worked out from your team (${n} ${n === 1 ? 'person' : 'people'} on it).` : 'Worked out from when you signed up.') : <>{worked('You chose this.')}{reset('shape.solo', 'Who sees clients')}</>}</>}>
        <span className={lock}><Choice label="Who sees clients" value={b.solo ? 'solo' : 'team'} options={[{ value: 'solo', label: 'Just me' }, { value: 'team', label: 'A team' }]}
          onChange={(v) => { if (canEdit && !busy) void save('shape.solo', v === 'solo', v === 'solo' ? (b.guessed.desk ? 'Saved: just you, with no front desk.' : 'Saved: just you.') : (b.guessed.desk ? 'Saved: a team, with a front desk.' : 'Saved: a team.')); }} /></span>
      </Row>
      <Row inline label="Front desk" help={<>{b.desk ? 'Someone at a front desk greets clients, checks them in and takes payment.' : `No front desk: clients are told to see ${b.person || 'you'} instead.`}
        {b.guessed.desk ? worked(b.solo ? 'Worked out: you see every client yourself.' : 'Worked out: most teams have one.') : <>{worked('You chose this.')}{reset('shape.desk', 'Front desk')}</>}</>}>
        <span className={lock}><Choice label="Front desk" value={b.desk ? 'yes' : 'no'} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
          onChange={(v) => { if (canEdit && !busy) void save('shape.desk', v === 'yes', v === 'yes' ? 'Saved: a front desk.' : 'Saved: no front desk.'); }} /></span>
      </Row>
      <Row inline label="Clients’ health details" help={<>Turn on if you keep them, as a med spa, clinic or therapy practice does. Messages stay discreet, staff screens sign out when idle, and who opens health answers is noted.
        {b.guessed.health ? worked('Worked out for you from your business’s details.') : <>{worked('You chose this.')}{reset('privacy.healthMode', 'Clients’ health details')}</>}
        {' '}<Link href="/settings/policies" className="relative underline underline-offset-2 after:absolute after:-inset-x-1 after:-inset-y-3 after:content-['']">More in Privacy</Link></>}>
        <Toggle label="Clients’ health details" checked={b.health} disabled={!canEdit || !!busy} onChange={(v) => void save('privacy.healthMode', v, v ? 'Saved: you keep clients’ health details.' : 'Saved: no health details kept.')} />
      </Row>
      {(said || !canEdit) && <p className="px-5 pb-4 text-[13.5px]" role={said && !said.ok ? 'alert' : 'status'} style={{ color: said && !said.ok ? '#b45309' : said ? '#1f7a4d' : 'var(--muted)' }}>{said ? said.text : 'Only the owner can change these.'}</p>}
    </Section>);
}
