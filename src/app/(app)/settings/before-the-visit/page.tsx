'use client';
// src/app/(app)/settings/before-the-visit/page.tsx — SETTINGS → BEFORE THE VISIT (approved design, canvas row 25
// "Services → Before the visit"). The business's choices (an "up to" or "about" price, deposit top-ups, what happens when
// there's more to do on the day, how big a change is approved on its own), then each service's few quick questions:
// every answer can add minutes, add one of the business's own add-ons, switch to another service, or be a safety answer.
// A live "Good to know" shows exactly what clients will read. Rules in lib/prep-check.
import * as React from 'react';
import { collection, doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { SettingsPage, Section, Row, Toggle, Choice, cfInput, cfInputStyle } from '@/components/settings/settings-ui';
import { prepSettingsOf, type OnDay, type PrepSettings } from '@/lib/prep-check';
import { CheckEditor } from '@/components/prep/CheckEditor';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', RED = '#b42318', AMBER = '#b45309';
const rid = () => Math.random().toString(36).slice(2, 9);

export default function BeforeTheVisitSettings() {
  const { selectedTenant, role } = useTenant() as any; const { firestore } = useFirebase(); const { toast } = useToast();
  const tenantId = selectedTenant?.id || ''; const r = String(role || '').toLowerCase(); const isOwner = r === 'owner'; const canServices = ['owner', 'admin', 'manager'].includes(r);
  const svcQ = useMemoFirebase(() => (firestore && tenantId ? collection(firestore as Firestore, `tenants/${tenantId}/services`) : null), [firestore, tenantId]);
  const { data: services } = useCollection<any>(svcQ);
  const [S, setS] = React.useState<PrepSettings | null>(null); const [dirty, setDirty] = React.useState(false); const [saving, setSaving] = React.useState(false); const [open, setOpen] = React.useState('');
  React.useEffect(() => { if (selectedTenant && !S) setS(prepSettingsOf(selectedTenant)); }, [selectedTenant, S]);
  if (!S) return <SettingsPage title="Before the visit"><p className="cf-muted">Loading…</p></SettingsPage>;
  const set = (p: Partial<PrepSettings>) => { if (!isOwner) return; setS({ ...S, ...p }); setDirty(true); };
  const save = async () => { if (!firestore || !tenantId) return; setSaving(true);
    try { await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}`), { prepCheck: S }); setDirty(false); toast({ title: 'Saved' }); } catch { toast({ title: 'That didn’t save', variant: 'destructive' }); } setSaving(false); };
  const all = (services || []) as any[]; const main = all.filter((x) => x.type !== 'addon' && x.status !== 'archived' && x.archived !== true).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return (
    <SettingsPage title="Before the visit" help="A few quick questions before maintenance visits — fills, rebalances, touch-ups — so the right time is saved. Clients see the time and price change before they agree; nothing changes on the booking until your team approves."
      actions={isOwner ? <button type="button" disabled={!dirty || saving} onClick={save} className="h-11 rounded-full px-5 text-[14.5px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{saving ? 'Saving…' : 'Save'}</button> : null}>
      <a href="/before-the-visit" className="cf-sheet flex items-center justify-between gap-3 px-5 py-4"><span className="min-w-0"><span className="block text-[15px] font-medium">Visits that need a decision</span><span className="block text-[13.5px] cf-muted">The next 8 days: changes that don’t fit, clients’ questions, safety answers.</span></span><span className="shrink-0 text-[14px] font-medium">Open →</span></a>
      <Section title="Your rules" help="Shown to clients in “Good to know”, so nothing is a surprise.">
        <div className="cf-sheet">
          <Row label="The price clients see" help="“Up to” means anything more needs a new yes. “About” is an estimate." inline><Choice<'upto' | 'about'> value={S.quote} label="Price" onChange={(v) => set({ quote: v })} options={[{ value: 'upto', label: 'Up to' }, { value: 'about', label: 'About' }]} /></Row>
          <Row label="When the price goes up" help="Ask for more deposit, or keep it as it is." inline>
            <Choice<'off' | 'over' | 'percent'> value={S.topUp.mode} label="Deposit" onChange={(v) => set({ topUp: { ...S.topUp, mode: v } })} options={[{ value: 'off', label: 'Keep the deposit' }, { value: 'over', label: 'Top up when it rises over…' }, { value: 'percent', label: 'Keep it a % of the price' }]} />
            {S.topUp.mode === 'over' && <span className="inline-flex items-center gap-2"><span className="text-[14px] cf-muted">$</span><input type="number" min={0} value={Math.round(S.topUp.overCents / 100)} onChange={(e) => set({ topUp: { ...S.topUp, overCents: Math.max(0, Number(e.target.value) || 0) * 100 } })} className={`${cfInput} w-24 text-center`} style={cfInputStyle} aria-label="Top up when it rises over" /></span>}
            {S.topUp.mode === 'percent' && <span className="inline-flex items-center gap-2"><input type="number" min={0} max={100} value={S.topUp.pct} onChange={(e) => set({ topUp: { ...S.topUp, pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } })} className={`${cfInput} w-20 text-center`} style={cfInputStyle} aria-label="Deposit percent" /><span className="text-[14px] cf-muted">%</span></span>}</Row>
          <Row label="More to do on the day" help="When there’s more than the client told you. The provider always shows the change and price first; the client can say no." inline>
            <Choice<OnDay> value={S.onDay} label="On the day" onChange={(v) => set({ onDay: v })} options={[{ value: 'fit_rebook', label: 'Do what fits, book the rest' }, { value: 'extend_or_move', label: 'Extend if free, else move' }, { value: 'provider', label: 'The provider decides' }]} /></Row>
          <Row label="Fee if it needs a new visit" help="Only if the client under-told you and the visit has to be moved. Leave at $0 for none." inline>
            <span className="inline-flex items-center gap-2"><span className="text-[14px] cf-muted">$</span><input type="number" min={0} value={Math.round(S.onDayFeeCents / 100)} onChange={(e) => set({ onDayFeeCents: Math.max(0, Number(e.target.value) || 0) * 100 })} className={`${cfInput} w-24 text-center`} style={cfInputStyle} aria-label="Fee" /></span></Row>
          <Row label="Approve small changes on their own" help="Changes up to this many minutes, made of add-ons only, that fit the free time after — held right away and approved without waiting." inline>
            <Choice<number> value={S.autoMinutes} label="Approve on their own" onChange={(v) => set({ autoMinutes: v })} options={[{ value: 0, label: 'Never' }, { value: 10, label: '10 min' }, { value: 15, label: '15 min' }, { value: 30, label: '30 min' }]} /></Row>
        </div>
        {!isOwner && <p className="text-[13.5px] cf-muted">Only the owner can change these.</p>}
      </Section>
      <Section title="Services" help="Turn it on for the services where the state matters. Renters set their own.">
        <div className="cf-sheet">{!main.length ? <p className="px-5 py-4 cf-muted">Add services first.</p> : main.map((s) => { const on = s.prepCheck?.on === true; const n = (s.prepCheck?.questions || []).length;
          return <div key={s.id} className="[&+&]:border-t" style={{ borderColor: 'var(--line)' }}>
            <button type="button" onClick={() => setOpen(open === s.id ? '' : s.id)} aria-expanded={open === s.id} className="flex w-full items-center gap-3 px-5 py-4 text-left">
              <span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">{s.name}</span><span className="block text-[13px] cf-muted">{on ? `${n} question${n === 1 ? '' : 's'} before the visit` : 'No questions'}</span></span>
              <span className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold" style={on ? { background: '#e9f3ed', color: '#1f7a4d' } : { background: SOFT, color: MUTED }}>{on ? 'On' : 'Off'}</span><span className="text-[16px] cf-muted">{open === s.id ? '–' : '+'}</span></button>
            {open === s.id && <CheckEditor key={s.id} service={s} services={all} tenant={selectedTenant} S={S} canEdit={canServices} onSave={async (check) => { await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}/services/${s.id}`), { prepCheck: check }); toast({ title: `${s.name} saved` }); }} />}
          </div>; })}</div>
      </Section>
    </SettingsPage>);
}
