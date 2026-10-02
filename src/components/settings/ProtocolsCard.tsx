'use client';
// src/components/settings/ProtocolsCard.tsx — CLEANING PROTOCOLS (O7): the library.
// Name, zone, steps (each Always / only if an add-on was done / only if the service uses something), and what it's
// used for (services → their turnover checklist; stations → their default and quarantine release). Saving makes a new
// version only when the steps changed; turnovers record the version they followed.
import * as React from 'react';
import { collection, doc, setDoc, writeBatch } from 'firebase/firestore';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { nextProtocol, newStep, conditionLabel, type Protocol, type ProtocolStep } from '@/lib/protocols';

export function ProtocolsCard({ tenantId, canEdit }: { tenantId: string; canEdit: boolean }) {
  const { firestore } = useFirebase() as any;
  const pQ = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'protocols') : null), [firestore, tenantId]);
  const sQ = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'services') : null), [firestore, tenantId]);
  const rQ = useMemoFirebase(() => (firestore && tenantId ? collection(firestore, 'tenants', tenantId, 'resources') : null), [firestore, tenantId]);
  const { data: protocols } = useCollection<any>(pQ); const { data: services } = useCollection<any>(sQ); const { data: resources } = useCollection<any>(rQ);
  const mainServices = (services || []).filter((s: any) => s.type !== 'addon'); const addOns = (services || []).filter((s: any) => s.type === 'addon');
  const reqNames = Array.from(new Set((services || []).flatMap((s: any) => (s.blueprint?.requirements || []).map((r: any) => String(r.name || '').trim())).filter(Boolean))).sort();
  const [edit, setEdit] = React.useState<{ id: string | null; name: string; zone: '' | 'clean' | 'dirty'; steps: ProtocolStep[]; svc: string[]; res: string[] } | null>(null);
  const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState('');
  const open = (p?: any) => setEdit(p ? { id: p.id, name: p.name, zone: p.zone || '', steps: p.steps || [], svc: mainServices.filter((s: any) => s.protocolId === p.id).map((s: any) => s.id), res: (resources || []).filter((r: any) => r.protocolId === p.id).map((r: any) => r.id) }
    : { id: null, name: '', zone: '', steps: [newStep('Clear and wipe down all surfaces'), newStep('Clean and disinfect tools'), newStep('Reset for the next client')], svc: [], res: [] });
  const setStep = (i: number, patch: Partial<ProtocolStep>) => setEdit((e) => e && ({ ...e, steps: e.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, d: number) => setEdit((e) => { if (!e) return e; const n = [...e.steps]; const j = i + d; if (j < 0 || j >= n.length) return e; [n[i], n[j]] = [n[j], n[i]]; return { ...e, steps: n }; });
  const save = async () => {
    if (!edit) return; setBusy(true); setMsg('');
    try {
      const prev = edit.id ? (protocols || []).find((p: any) => p.id === edit.id) : null;
      const ref = edit.id ? doc(firestore, 'tenants', tenantId, 'protocols', edit.id) : doc(collection(firestore, 'tenants', tenantId, 'protocols'));
      const next = nextProtocol(prev, edit.name, edit.steps, (edit.zone || null) as any);
      await setDoc(ref, { ...next, id: ref.id });
      const b = writeBatch(firestore);   // attach to / detach from services and stations
      for (const s of mainServices) { const want = edit.svc.includes(s.id); if (want && s.protocolId !== ref.id) b.update(doc(firestore, 'tenants', tenantId, 'services', s.id), { protocolId: ref.id }); if (!want && s.protocolId === ref.id) b.update(doc(firestore, 'tenants', tenantId, 'services', s.id), { protocolId: null }); }
      for (const r of resources || []) { const want = edit.res.includes(r.id); if (want && r.protocolId !== ref.id) b.update(doc(firestore, 'tenants', tenantId, 'resources', r.id), { protocolId: ref.id }); if (!want && r.protocolId === ref.id) b.update(doc(firestore, 'tenants', tenantId, 'resources', r.id), { protocolId: null }); }
      await b.commit();
      setMsg(prev && next.version === prev.version ? 'Saved.' : `Saved as version ${next.version}.`); setEdit(null);
    } catch { setMsg('That didn’t save — try again.'); }
    setBusy(false);
  };
  const tick = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <section className="space-y-4">
      <div><h2 className="text-[19px] font-semibold tracking-tight">Your cleaning procedures</h2>
        <p className="text-sm text-muted-foreground">Your cleaning procedures. Attached to a service, they become its turnover checklist — showing only the steps that visit needed. Attached to a station, they’re its default and what releases it from quarantine.</p></div>
      {(protocols || []).map((p: any) => (
        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 p-3">
          <div><p className="font-semibold">{p.name} <span className="text-xs font-normal text-muted-foreground">v{p.version}{p.zone ? ` · ${p.zone} zone` : ''}</span></p>
            <p className="text-xs text-muted-foreground">{(p.steps || []).length} steps · used by {mainServices.filter((s: any) => s.protocolId === p.id).length} services, {(resources || []).filter((r: any) => r.protocolId === p.id).length} stations</p></div>
          {canEdit && <button type="button" onClick={() => open(p)} className="h-9 rounded-full border px-4 text-sm">Edit</button>}
        </div>))}
      {!edit && canEdit && <button type="button" onClick={() => open()} className="h-10 rounded-full border-2 px-4 text-sm font-semibold">+ New protocol</button>}
      {edit && (
        <div className="space-y-4 rounded-2xl border-2 border-dashed p-4">
          <div className="flex flex-wrap gap-2">
            <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value.slice(0, 80) })} placeholder="e.g. Pedicure spa — between clients" className="h-11 min-w-[12rem] flex-1 rounded-xl border-2 px-3" />
            <select value={edit.zone} onChange={(e) => setEdit({ ...edit, zone: e.target.value as any })} className="h-11 rounded-xl border-2 px-2 text-sm" aria-label="Zone"><option value="">No zone</option><option value="clean">Clean zone</option><option value="dirty">Dirty zone</option></select>
          </div>
          <div className="space-y-2">
            {edit.steps.map((st, i) => (
              <div key={st.id} className="space-y-2 rounded-xl border p-2.5">
                <div className="flex gap-2"><span className="pt-2.5 text-xs text-muted-foreground">{i + 1}.</span>
                  <input value={st.text} onChange={(e) => setStep(i, { text: e.target.value.slice(0, 160) })} placeholder="What to do" className="h-10 min-w-0 flex-1 rounded-lg border px-3 text-sm" /></div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select value={st.condition.type === 'addon' ? `addon:${st.condition.addOnId}` : st.condition.type === 'requirement' ? `req:${st.condition.name}` : 'always'}
                    onChange={(e) => { const v = e.target.value; setStep(i, { condition: v.startsWith('addon:') ? { type: 'addon', addOnId: v.slice(6), label: addOns.find((a: any) => a.id === v.slice(6))?.name } : v.startsWith('req:') ? { type: 'requirement', name: v.slice(4) } : { type: 'always' } }); }}
                    className="h-9 max-w-full rounded-lg border px-2" aria-label="When">
                    <option value="always">Always</option>
                    {addOns.map((a: any) => <option key={a.id} value={`addon:${a.id}`}>Only if add-on: {a.name}</option>)}
                    {reqNames.map((n) => <option key={n} value={`req:${n}`}>Only if the service uses: {n}</option>)}
                  </select>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="h-8 w-8 rounded-lg border disabled:opacity-30" aria-label="Move up">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === edit.steps.length - 1} className="h-8 w-8 rounded-lg border disabled:opacity-30" aria-label="Move down">↓</button>
                  <button type="button" onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_, j) => j !== i) })} className="h-8 rounded-lg border px-2">Remove</button>
                  {st.condition.type !== 'always' && <span className="text-muted-foreground">{conditionLabel(st.condition, (id) => addOns.find((a: any) => a.id === id)?.name)}</span>}
                </div>
              </div>))}
            <button type="button" onClick={() => setEdit({ ...edit, steps: [...edit.steps, newStep()] })} className="h-9 rounded-full border-2 px-3 text-xs font-semibold">+ Add a step</button>
          </div>
          <div className="space-y-2"><p className="text-sm font-semibold">Used for</p>
            <div className="flex flex-wrap gap-2">{mainServices.map((s: any) => <label key={s.id} className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs"><input type="checkbox" checked={edit.svc.includes(s.id)} onChange={() => setEdit({ ...edit, svc: tick(edit.svc, s.id) })} />{s.name}</label>)}</div>
            {(resources || []).length > 0 && <div className="flex flex-wrap gap-2">{(resources || []).map((r: any) => <label key={r.id} className="flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-xs"><input type="checkbox" checked={edit.res.includes(r.id)} onChange={() => setEdit({ ...edit, res: tick(edit.res, r.id) })} />Station: {r.name}</label>)}</div>}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy || !edit.name.trim() || !edit.steps.some((s) => s.text.trim())} onClick={save} className="h-10 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setEdit(null)} className="h-10 rounded-full px-4 text-sm">Cancel</button>
          </div>
        </div>)}
      {msg && <p className="text-sm" role="status">{msg}</p>}
    </section>
  );
}
