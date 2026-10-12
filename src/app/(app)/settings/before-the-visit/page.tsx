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
import { prepSettingsOf, cleanCheck, goodToKnow, STARTERS, type PrepSettings, type PrepQuestion, type OnDay } from '@/lib/prep-check';

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

function CheckEditor({ service, services, tenant, S, canEdit, onSave }: { service: any; services: any[]; tenant: any; S: PrepSettings; canEdit: boolean; onSave: (c: any) => Promise<void> }) {
  const [on, setOn] = React.useState<boolean>(service.prepCheck?.on === true);
  const [qs, setQs] = React.useState<PrepQuestion[]>(Array.isArray(service.prepCheck?.questions) ? service.prepCheck.questions : []);
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const addOns = services.filter((x) => x.type === 'addon' && x.status !== 'archived').sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const others = services.filter((x) => x.type !== 'addon' && x.id !== service.id && x.status !== 'archived').sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const pq = (i: number, p: Partial<PrepQuestion>) => setQs((x) => x.map((q, j) => (j === i ? { ...q, ...p } : q)));
  const po = (i: number, k: number, p: any) => setQs((x) => x.map((q, j) => (j === i ? { ...q, options: q.options.map((o, m) => (m === k ? { ...o, ...p, effect: { ...o.effect, ...(p.effect || {}) } } : o)) } : q)));
  const cleaned = cleanCheck({ on, questions: qs }, Number(service.prepCheck?.version) || 0);
  const preview = goodToKnow(tenant, service, services, cleaned, S);
  const save = async () => { setErr(''); if (on && !cleaned.questions.length) { setErr('Add at least one question with two answers.'); return; } setBusy(true); try { await onSave(cleaned); } catch { setErr('That didn’t save.'); } setBusy(false); };
  const sel = 'h-9 rounded-[10px] border bg-white px-2 text-[13px]';
  return (
    <div className="grid gap-4 border-t px-5 pb-5 pt-4 lg:grid-cols-[1fr_320px]" style={{ borderColor: LINE, background: 'rgba(250,250,251,.7)', color: INK }}>
      <div className="min-w-0 space-y-3">
        <label className="flex items-center justify-between gap-2 text-[15px] font-semibold"><span>Ask before {service.name}</span><input type="checkbox" checked={on} disabled={!canEdit} onChange={(e) => setOn(e.target.checked)} className="h-5 w-5" style={{ accentColor: INK }} /></label>
        {!qs.length && <div className="flex flex-wrap items-center gap-1.5"><span className="text-[13px]" style={{ color: MUTED }}>Start from:</span>{STARTERS.map((st) => <button key={st.key} type="button" disabled={!canEdit} onClick={() => { setQs(st.questions.map((q) => ({ ...q, id: rid(), options: q.options.map((o) => ({ ...o, id: rid() })) }))); setOn(true); }} className="h-9 rounded-full px-3.5 text-[13px]" style={{ background: SOFT }}>{st.name}</button>)}</div>}
        {qs.map((q, i) => <div key={q.id} className="space-y-2 rounded-[16px] border bg-white p-3.5" style={{ borderColor: LINE }}>
          <div className="flex gap-2"><input value={q.label} disabled={!canEdit} onChange={(e) => pq(i, { label: e.target.value })} placeholder="The question, e.g. How many nails are lifting?" aria-label="Question" className={`${cfInput} flex-1`} style={cfInputStyle} />
            <select value={q.kind} disabled={!canEdit} onChange={(e) => pq(i, { kind: e.target.value as any, options: e.target.value === 'photo' ? [] : q.options.length ? q.options : [{ id: rid(), label: 'No', effect: {} }, { id: rid(), label: 'Yes', effect: {} }] })} aria-label="Kind" className={sel} style={{ borderColor: LINE }}><option value="choice">Answers</option><option value="photo">A photo</option></select>
            <button type="button" disabled={!canEdit} onClick={() => setQs((x) => x.filter((_, j) => j !== i))} aria-label="Remove question" className="h-9 rounded-full px-3 text-[12.5px]" style={{ background: SOFT, color: RED }}>Remove</button></div>
          <input value={q.help || ''} disabled={!canEdit} onChange={(e) => pq(i, { help: e.target.value })} placeholder="A short hint (optional)" aria-label="Hint" className={cfInput} style={cfInputStyle} />
          {q.kind === 'choice' && <div className="space-y-2">{q.options.map((o, k) => <div key={o.id} className="space-y-1.5 rounded-[12px] p-2.5" style={{ background: o.effect.safety ? '#fdecec' : SOFT }}>
            <div className="flex flex-wrap items-center gap-1.5">
              <input value={o.label} disabled={!canEdit} onChange={(e) => po(i, k, { label: e.target.value })} placeholder="Answer" aria-label="Answer" className="h-9 w-36 rounded-[10px] border bg-white px-2.5 text-[13.5px]" style={{ borderColor: LINE }} />
              {!o.effect.safety && <><label className="inline-flex items-center gap-1 text-[13px]">+<input type="number" min={0} max={240} disabled={!canEdit} value={o.effect.addMinutes || ''} onChange={(e) => po(i, k, { effect: { addMinutes: Number(e.target.value) || 0 } })} placeholder="0" aria-label="Extra minutes" className="h-9 w-14 rounded-[10px] border bg-white text-center" style={{ borderColor: LINE }} />min</label>
                <select disabled={!canEdit} value={o.effect.addOns?.[0]?.id || ''} onChange={(e) => po(i, k, { effect: { addOns: e.target.value ? [{ id: e.target.value, qty: o.effect.addOns?.[0]?.qty || 1 }] : [] } })} aria-label="Add-on" className={sel} style={{ borderColor: LINE }}><option value="">No add-on</option>{addOns.map((a) => <option key={a.id} value={a.id}>{a.name} · ${Number(a.price) || 0}</option>)}</select>
                {!!o.effect.addOns?.[0]?.id && <label className="inline-flex items-center gap-1 text-[13px]">×<input type="number" min={1} max={20} disabled={!canEdit} value={o.effect.addOns[0].qty || 1} onChange={(e) => po(i, k, { effect: { addOns: [{ id: o.effect.addOns![0].id, qty: Math.max(1, Number(e.target.value) || 1) }] } })} aria-label="How many" className="h-9 w-12 rounded-[10px] border bg-white text-center" style={{ borderColor: LINE }} /></label>}
                <select disabled={!canEdit} value={o.effect.switchServiceId || ''} onChange={(e) => po(i, k, { effect: { switchServiceId: e.target.value || null } })} aria-label="Switch to" className={sel} style={{ borderColor: LINE }}><option value="">Same service</option>{others.map((a) => <option key={a.id} value={a.id}>Switch to {a.name}</option>)}</select></>}
              <label className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: o.effect.safety ? RED : MUTED }}><input type="checkbox" disabled={!canEdit} checked={!!o.effect.safety} onChange={(e) => po(i, k, { effect: e.target.checked ? { safety: true, safetyText: o.effect.safetyText || 'Please don’t come in with this — we’ll call you and move your visit for free.', addMinutes: 0, addOns: [], switchServiceId: null } : { safety: false } })} style={{ accentColor: RED }} />Safety</label>
              <button type="button" disabled={!canEdit || q.options.length <= 2} onClick={() => pq(i, { options: q.options.filter((_, m) => m !== k) })} aria-label="Remove answer" className="ml-auto h-8 w-8 rounded-full bg-white text-[12px] disabled:opacity-30">✕</button></div>
            {o.effect.safety ? <input value={o.effect.safetyText || ''} disabled={!canEdit} onChange={(e) => po(i, k, { effect: { safetyText: e.target.value } })} placeholder="What the client reads" aria-label="Safety message" className="h-9 w-full rounded-[10px] border bg-white px-2.5 text-[13px]" style={{ borderColor: LINE }} />
              : <input value={o.note || ''} disabled={!canEdit} onChange={(e) => po(i, k, { note: e.target.value })} placeholder="Your own words for “Good to know” (optional)" aria-label="Good to know wording" className="h-9 w-full rounded-[10px] border bg-white px-2.5 text-[13px]" style={{ borderColor: LINE }} />}
          </div>)}
            {q.options.length < 5 && <button type="button" disabled={!canEdit} onClick={() => pq(i, { options: [...q.options, { id: rid(), label: '', effect: {} }] })} className="h-8 rounded-full px-3 text-[12.5px]" style={{ background: '#fff', border: `1px solid ${LINE}` }}>+ Answer</button>}</div>}
        </div>)}
        {qs.length > 0 && qs.length < 5 && <button type="button" disabled={!canEdit} onClick={() => setQs((x) => [...x, { id: rid(), label: '', kind: 'choice', options: [{ id: rid(), label: 'No', effect: {} }, { id: rid(), label: 'Yes', effect: {} }] }])} className="h-9 rounded-full px-3.5 text-[13px]" style={{ background: SOFT }}>+ Add a question</button>}
        {!service.lateServiceId && <p className="text-[12.5px]" style={{ color: AMBER }}>Tip: set this service’s “if they leave it too long” service (Services → {service.name} → Coming back) and clients who don’t answer still get the right suggestion.</p>}
      </div>
      <div className="space-y-3">
        <div className="rounded-[16px] border bg-white p-4" style={{ borderColor: LINE }}><p className="pb-1 text-[14px] font-bold">Good to know — what clients read</p>
          {preview.map((g, i) => <div key={i} className="flex gap-2 py-1 text-[13px] leading-snug"><span style={{ color: MUTED }}>•</span><span>{g}</span></div>)}</div>
        {err && <p className="text-[13px]" style={{ color: RED }}>{err}</p>}
        <button type="button" disabled={busy || !canEdit} onClick={save} className="h-11 w-full rounded-full text-[14.5px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>);
}
