'use client';
// src/app/(app)/settings/making-it-right/page.tsx — SETTINGS → MAKING IT RIGHT: the business's own rules for complaints,
// redos and refunds (tenant.makingItRight, read through lib/making-it-right settingsOf). Starts from a set that fits the
// kind of business; everything can be changed: what clients can say went wrong (and which of those are safety), the fixes
// offered, the redo window (per service too), who can decide what, how fast to reply, fair-use limits, how a redo or
// refund touches pay, and how long records are kept.
import * as React from 'react';
import { collection, doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { SettingsPage, Section, Row, Toggle, Choice, More, cfInput, cfInputStyle } from '@/components/settings/settings-ui';
import { settingsOf, PRESETS, FIX_LABEL, FIX_HINT, type MirSettings, type FixKind, type Reason } from '@/lib/making-it-right';

export default function MakingItRightSettings() {
  const { selectedTenant, role } = useTenant() as any; const { firestore } = useFirebase(); const { toast } = useToast();
  const tenantId = selectedTenant?.id || ''; const canEdit = String(role || '').toLowerCase() === 'owner';
  const [s, setS] = React.useState<MirSettings | null>(null); const [dirty, setDirty] = React.useState(false); const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (selectedTenant && !s) setS(settingsOf(selectedTenant)); }, [selectedTenant, s]);
  const svcQ = useMemoFirebase(() => (firestore && tenantId ? collection(firestore as Firestore, `tenants/${tenantId}/services`) : null), [firestore, tenantId]);
  const { data: services } = useCollection<any>(svcQ);
  const [newReason, setNewReason] = React.useState(''); const [svcPick, setSvcPick] = React.useState('');
  if (!s) return <SettingsPage title="Making it right"><p className="cf-muted">Loading…</p></SettingsPage>;
  const set = (patch: Partial<MirSettings>) => { setS({ ...s, ...patch }); setDirty(true); };
  const fu = (patch: Partial<MirSettings['fairUse']>) => set({ fairUse: { ...s.fairUse, ...patch } });
  const Num = ({ value, onChange, suffix, prefix, width = 'w-20' }: { value: number; onChange: (n: number) => void; suffix?: string; prefix?: string; width?: string }) => (
    <span className="inline-flex items-center gap-2">{prefix && <span className="text-[14px] cf-muted">{prefix}</span>}<input type="number" inputMode="numeric" min={0} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} className={`${cfInput} ${width} text-center`} style={cfInputStyle} disabled={!canEdit} />{suffix && <span className="text-[14px] cf-muted">{suffix}</span>}</span>);
  const save = async () => {
    if (!firestore || !tenantId) return; setSaving(true);
    try { await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { makingItRight: JSON.parse(JSON.stringify(s)) }); setDirty(false); toast({ title: 'Making it right saved' }); }
    catch { toast({ title: 'That didn’t save', description: 'Only the owner can change these.', variant: 'destructive' }); }
    setSaving(false);
  };
  const svcName = (id: string) => (services || []).find((x: any) => x.id === id)?.name || 'A service';
  const setReason = (i: number, patch: Partial<Reason>) => set({ reasons: s.reasons.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <SettingsPage title="Making it right" help="When a client isn’t happy: what they can tell you, what you can offer, who decides, and the limits that keep it fair."
      actions={canEdit ? <button type="button" onClick={save} disabled={!dirty || saving} className="h-11 rounded-full px-6 text-[15px] font-semibold disabled:opacity-40" style={{ background: 'var(--ink)', color: 'var(--card)' }}>{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}</button> : undefined}>
      {!canEdit && <p className="rounded-2xl px-4 py-3 text-[14px]" style={{ background: 'var(--soft)' }}>Only the owner can change these.</p>}

      <Section title="Start from" help="A starting set for your kind of business. Picking another one replaces the list of what can go wrong and the usual windows.">
        <Row label="Kind of business" inline>
          <select value={s.preset} disabled={!canEdit} onChange={(e) => { const P = PRESETS[e.target.value]; set({ preset: e.target.value, reasons: P.reasons, redoWindowDays: P.window, fairUse: { ...s.fairUse, wearDays: P.wearDays } }); }} className={`${cfInput} w-56`} style={cfInputStyle}>
            {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
          </select>
        </Row>
      </Section>

      <Section title="What clients can tell you" help="The choices a client, the desk or a provider picks from. Safety ones go straight to a manager, start an incident report, and nothing is offered automatically.">
        {s.reasons.map((r, i) => (
          <div key={r.id + i} className="flex flex-wrap items-center gap-3 px-5 py-3 [&+&]:border-t" style={{ borderColor: 'var(--line)' }}>
            <Toggle checked={r.on !== false} onChange={(v) => setReason(i, { on: v })} label={`Use “${r.label}”`} disabled={!canEdit} />
            <input value={r.label} onChange={(e) => setReason(i, { label: e.target.value })} disabled={!canEdit} className={`${cfInput} h-10 min-w-[12rem] flex-1`} style={cfInputStyle} aria-label="What went wrong" />
            <button type="button" disabled={!canEdit} onClick={() => setReason(i, { safety: !r.safety })} className="h-9 rounded-full px-3.5 text-[13px] font-semibold" style={r.safety ? { background: '#fdecec', color: '#b42318' } : { background: 'var(--soft)', color: 'var(--muted)' }} aria-pressed={!!r.safety}>{r.safety ? 'Safety' : 'Not safety'}</button>
          </div>))}
        {canEdit && <div className="flex gap-2 px-5 py-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <input value={newReason} onChange={(e) => setNewReason(e.target.value)} placeholder="Add another, e.g. Product ran out" className={`${cfInput} h-10 flex-1`} style={cfInputStyle} />
          <button type="button" disabled={!newReason.trim()} onClick={() => { set({ reasons: [...s.reasons, { id: `own_${Date.now().toString(36)}`, label: newReason.trim(), on: true }] }); setNewReason(''); }} className="h-10 rounded-full px-4 text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--soft)' }}>Add</button>
        </div>}
      </Section>

      <Section title="What you can offer" help="The fixes the team can choose on a case.">
        {(Object.keys(FIX_LABEL) as FixKind[]).map((k) => <Row key={k} label={FIX_LABEL[k]} help={FIX_HINT[k]} inline><Toggle checked={!!s.fixes[k]} onChange={(v) => set({ fixes: { ...s.fixes, [k]: v } })} label={FIX_LABEL[k]} disabled={!canEdit} /></Row>)}
      </Section>

      <Section title="Redo window" help="How long after a visit a client can ask for a free redo. After that, the case still opens — it just needs a manager.">
        <Row label="Usual window" inline><Num value={s.redoWindowDays} onChange={(n) => set({ redoWindowDays: n })} suffix="days" /></Row>
        {Object.entries(s.serviceWindows).map(([id, d]) => (
          <Row key={id} label={svcName(id)} inline><span className="inline-flex items-center gap-3"><Num value={d} onChange={(n) => set({ serviceWindows: { ...s.serviceWindows, [id]: n } })} suffix="days" />
            {canEdit && <button type="button" className="text-[14px] cf-muted underline" onClick={() => { const w = { ...s.serviceWindows }; delete w[id]; set({ serviceWindows: w }); }}>Remove</button>}</span></Row>))}
        {canEdit && (services || []).length > 0 && <div className="flex flex-wrap gap-2 px-5 py-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <select value={svcPick} onChange={(e) => setSvcPick(e.target.value)} className={`${cfInput} h-10 flex-1`} style={cfInputStyle} aria-label="Service">
            <option value="">A different window for one service…</option>
            {(services || []).filter((x: any) => !(x.id in s.serviceWindows) && !x.archived).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <button type="button" disabled={!svcPick} onClick={() => { set({ serviceWindows: { ...s.serviceWindows, [svcPick]: s.redoWindowDays } }); setSvcPick(''); }} className="h-10 rounded-full px-4 text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--soft)' }}>Add</button>
        </div>}
      </Section>

      <Section title="Who can decide" help="Anything over these limits is sent to a manager to approve. Managers can always decide. Safety cases are always a manager’s.">
        <Row label="The desk can refund or credit up to" inline><Num value={Math.round(s.deskLimitCents / 100)} onChange={(n) => set({ deskLimitCents: n * 100 })} prefix="$" /></Row>
        <Row label="The desk can book free redos" inline><Toggle checked={s.deskRedos > 0} onChange={(v) => set({ deskRedos: v ? 1 : 0 })} label="The desk can book free redos" disabled={!canEdit} /></Row>
        <Row label="Providers can offer a redo themselves" help="Only within the window, and only when the fair-use checks pass." inline><Toggle checked={s.providersCanOfferRedo} onChange={(v) => set({ providersCanOfferRedo: v })} label="Providers can offer a redo" disabled={!canEdit} /></Row>
      </Section>

      <Section title="How fast" help="The case shows a clock until someone replies, and reminds the team to check back once the fix is done.">
        <Row label="Reply to the client within" inline><Num value={s.replyHours} onChange={(n) => set({ replyHours: Math.max(1, n) })} suffix="hours" /></Row>
        <Row label="Check back after the fix" inline><Num value={s.followUpDays} onChange={(n) => set({ followUpDays: Math.max(1, n) })} suffix="days" /></Row>
      </Section>

      <Section title="How complaints come in">
        <Row label="Phone calls and the desk" help="“Start a case” from a call or at checkout." inline><Toggle checked={s.channels.calls} onChange={(v) => set({ channels: { ...s.channels, calls: v } })} label="Phone calls and the desk" disabled={!canEdit} /></Row>
        <Row label="Providers" help="“They weren’t happy” on a finished visit in the staff app." inline><Toggle checked={s.channels.staff} onChange={(v) => set({ channels: { ...s.channels, staff: v } })} label="Providers" disabled={!canEdit} /></Row>
        <Row label="“How was your visit?” text" help="Coming next — a short text after each visit." inline><Toggle checked={s.channels.survey} onChange={(v) => set({ channels: { ...s.channels, survey: v } })} label="How was your visit text" disabled={!canEdit} /></Row>
        <Row label="“Not quite right?” on the visit link" help="Coming next — on the page clients already get for their visit." inline><Toggle checked={s.channels.visitLink} onChange={(v) => set({ channels: { ...s.channels, visitLink: v } })} label="Not quite right on the visit link" disabled={!canEdit} /></Row>
      </Section>

      <Section title="Keeping it fair" help="Checked on every case. A case that doesn’t pass still opens — it just goes to a manager with the reason shown, never an automatic no.">
        <Row label="Fixes per client" inline><span className="inline-flex flex-wrap items-center gap-2"><Num value={s.fairUse.maxFixes} onChange={(n) => fu({ maxFixes: Math.max(1, n) })} width="w-16" /><span className="text-[14px] cf-muted">in</span><Num value={s.fairUse.perMonths} onChange={(n) => fu({ perMonths: Math.max(1, n) })} width="w-16" suffix="months" /></span></Row>
        <Row label="Ask for photos" help="For anything that can be seen." inline><Toggle checked={s.fairUse.requirePhotos} onChange={(v) => fu({ requirePhotos: v })} label="Ask for photos" disabled={!canEdit} /></Row>
        <Row label="Normal wear after" help="Past this, a complaint is likely wear rather than the work." inline><Num value={s.fairUse.wearDays} onChange={(n) => fu({ wearDays: n })} suffix="days" /></Row>
        <Row label="Redo is the same service only" help="No upgrading to something else." inline><Toggle checked={s.fairUse.sameServiceOnly} onChange={(v) => fu({ sameServiceOnly: v })} label="Same service only" disabled={!canEdit} /></Row>
        <Row label="Original provider gets the first chance" inline><Toggle checked={s.fairUse.originalProviderFirst} onChange={(v) => fu({ originalProviderFirst: v })} label="Original provider first" disabled={!canEdit} /></Row>
        <Row label="Refunds go back to the card they paid with" help="Never cash or a different card." inline><Toggle checked={s.fairUse.refundToOriginalCard} onChange={(v) => fu({ refundToOriginalCard: v })} label="Refund to original card" disabled={!canEdit} /></Row>
        <Row label="Client confirms it’s fixed" help="Closing a case asks them, so it can’t be reopened later for the same thing." inline><Toggle checked={s.fairUse.clientConfirms} onChange={(v) => fu({ clientConfirms: v })} label="Client confirms" disabled={!canEdit} /></Row>
      </Section>

      <More label="Pay and records" help="How a redo or refund shows on pay stubs, and how long cases are kept.">
        <Section title="Pay">
          <Row label="Whoever does the redo is paid">
            <Choice value={s.payRules.redoProvider} onChange={(v) => set({ payRules: { ...s.payRules, redoProvider: v } })} label="Redo pay" options={[{ value: 'none', label: 'Nothing' }, { value: 'half', label: 'Half' }, { value: 'normal', label: 'Normal' }]} /></Row>
          <Row label="The original provider">
            <Choice value={s.payRules.originalProvider} onChange={(v) => set({ payRules: { ...s.payRules, originalProvider: v } })} label="Original provider" options={[{ value: 'keep', label: 'Keeps their pay' }, { value: 'split', label: 'Shares the redo cost' }, { value: 'pays', label: 'Covers the redo' }]} /></Row>
          <Row label="When there’s a refund, their commission">
            <Choice value={s.payRules.refund} onChange={(v) => set({ payRules: { ...s.payRules, refund: v } })} label="Refund pay" options={[{ value: 'take_back', label: 'Comes back off' }, { value: 'keep', label: 'Stays' }]} /></Row>
        </Section>
        <Section title="Records" help="Closed cases are locked; later notes are added with a date. Incident reports are kept for at least this long.">
          <Row label="Keep cases for" inline><Num value={s.retentionYears} onChange={(n) => set({ retentionYears: Math.max(1, n) })} suffix="years" /></Row>
        </Section>
      </More>
    </SettingsPage>
  );
}
