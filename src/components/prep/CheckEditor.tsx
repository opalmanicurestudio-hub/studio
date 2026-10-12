'use client';
// src/components/prep/CheckEditor.tsx — one service's questions for "Before the visit" (lib/prep-check): each answer can add
// minutes, add an add-on (with a count), switch to another service, or be a safety answer — with a live "Good to know".
// Used by Settings → Before the visit, and by renters for their own services in their portal.
import * as React from 'react';
import { cfInput, cfInputStyle } from '@/components/settings/settings-ui';
import { cleanCheck, goodToKnow, STARTERS, type PrepSettings, type PrepQuestion } from '@/lib/prep-check';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f3f3f5', RED = '#b42318', AMBER = '#b45309';
const rid = () => Math.random().toString(36).slice(2, 9);

export function CheckEditor({ service, services, tenant, S, canEdit, onSave, addOnPool, renter = false }: { service: any; services: any[]; tenant: any; S: PrepSettings; canEdit: boolean; onSave: (c: any) => Promise<void>; addOnPool?: any[]; renter?: boolean }) {
  const [on, setOn] = React.useState<boolean>(service.prepCheck?.on === true);
  const [qs, setQs] = React.useState<PrepQuestion[]>(Array.isArray(service.prepCheck?.questions) ? service.prepCheck.questions : []);
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const addOns = (addOnPool || services.filter((x) => x.type === 'addon' && x.status !== 'archived')).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const others = services.filter((x) => x.type !== 'addon' && x.id !== service.id && x.status !== 'archived').sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const pq = (i: number, p: Partial<PrepQuestion>) => setQs((x) => x.map((q, j) => (j === i ? { ...q, ...p } : q)));
  const po = (i: number, k: number, p: any) => setQs((x) => x.map((q, j) => (j === i ? { ...q, options: q.options.map((o, m) => (m === k ? { ...o, ...p, effect: { ...o.effect, ...(p.effect || {}) } } : o)) } : q)));
  const cleaned = cleanCheck({ on, questions: qs }, Number(service.prepCheck?.version) || 0);
  const preview = goodToKnow(renter ? null : tenant, service, services, cleaned, S);
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
        {!renter && !service.lateServiceId && <p className="text-[12.5px]" style={{ color: AMBER }}>Tip: set this service’s “if they leave it too long” service (Services → {service.name} → Coming back) and clients who don’t answer still get the right suggestion.</p>}
      </div>
      <div className="space-y-3">
        <div className="rounded-[16px] border bg-white p-4" style={{ borderColor: LINE }}><p className="pb-1 text-[14px] font-bold">Good to know — what clients read</p>
          {preview.map((g, i) => <div key={i} className="flex gap-2 py-1 text-[13px] leading-snug"><span style={{ color: MUTED }}>•</span><span>{g}</span></div>)}</div>
        {err && <p className="text-[13px]" style={{ color: RED }}>{err}</p>}
        <button type="button" disabled={busy || !canEdit} onClick={save} className="h-11 w-full rounded-full text-[14.5px] font-semibold text-white disabled:opacity-40" style={{ background: INK }}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>);
}
