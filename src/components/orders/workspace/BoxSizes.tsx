'use client';
// src/components/orders/workspace/BoxSizes.tsx — THE SHOP'S BOX SIZES, from the order (managers). Each has a name, three
// sides and the empty box's weight; the packer picks from them, and each label is bought for the box it's packed in.
// Saved by the server (api/retail/box-sizes); a box already chosen on an order keeps its own size.
import * as React from 'react';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { presetsOf, type Preset } from '@/lib/ship-run';
import { MAX_BOX_SIZES, cleanPreset } from '@/lib/box-sizes';
import { Btn, C, Sheet, feel, muted } from '../ui';

type Draft = { id?: string; name: string; lengthIn: string; widthIn: string; heightIn: string; weightOz: string };
const blank: Draft = { name: '', lengthIn: '', widthIn: '', heightIn: '', weightOz: '' };
const toDraft = (p: Preset): Draft => ({ id: p.id, name: p.name, lengthIn: String(p.lengthIn), widthIn: String(p.widthIn), heightIn: String(p.heightIn), weightOz: String(p.weightOz) });

export function BoxSizesSheet({ tenantId, rs, onClose, onToast }: { tenantId: string; rs: any; onClose: () => void; onToast: (m: string) => void }) {
  const [list, setList] = React.useState<Preset[]>(() => presetsOf(rs));
  React.useEffect(() => { setList(presetsOf(rs)); }, [rs]);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(''); const [err, setErr] = React.useState('');
  const post = async (body: any) => {
    const r = await fetch('/api/retail/box-sizes', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, ...body }) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok && d.ok, d };
  };
  const save = async () => {
    if (!draft) return;
    const { error } = cleanPreset(draft);
    if (error) { setErr(error); return; }
    setBusy('save'); setErr('');
    const { ok, d } = await post({ action: 'save', preset: draft });
    setBusy(''); feel(ok);
    if (!ok) { setErr(d.error || 'That didn’t save. Try again.'); return; }
    setList(d.presets || list); setDraft(null); onToast(d.message || 'Box size saved.');
  };
  const remove = async (p: Preset) => {
    setBusy(p.id); setErr('');
    const { ok, d } = await post({ action: 'remove', id: p.id });
    setBusy(''); feel(ok);
    if (!ok) { setErr(d.error || 'That didn’t go through. Try again.'); return; }
    setList(d.presets || list.filter((x) => x.id !== p.id)); onToast(d.message || 'Box size removed.');
  };
  const input = 'mt-1 block h-11 w-full rounded-xl border px-3 text-[16px] font-normal';
  const style = { borderColor: C.line, background: C.paper, color: C.ink };
  return (
    <Sheet title="Box sizes" sub="The boxes your team packs into. Each label is bought for the box it’s packed in." onClose={onClose} closeLabel="Done">
      <div className="mt-2">
        {list.length === 0 && <p className="m-0 py-3 text-[15px]" style={muted}>No sizes yet. Without them, labels are bought for a standard 10 × 8 × 4 inch box.</p>}
        {list.map((p) => (
          <div key={p.id} className="flex min-h-[56px] items-center justify-between gap-3 border-b py-2" style={{ borderColor: C.line }}>
            <span className="min-w-0"><span className="block truncate text-[16px] font-semibold">{p.name}</span><span className="block text-[13.5px]" style={muted}>{p.lengthIn} × {p.widthIn} × {p.heightIn} in · {p.weightOz} oz empty</span></span>
            <span className="flex shrink-0 gap-3">
              <button type="button" onClick={() => { setErr(''); setDraft(toDraft(p)); }} className="h-10 text-[14px] font-semibold underline underline-offset-4">Change</button>
              <button type="button" disabled={busy === p.id} onClick={() => void remove(p)} className="h-10 text-[14px] font-semibold underline underline-offset-4" style={{ color: C.bad }}>{busy === p.id ? 'Removing…' : 'Remove'}</button>
            </span>
          </div>))}
      </div>
      {draft ? (
        <div className="mt-4 rounded-2xl p-4" style={{ background: C.soft }}>
          <p className="m-0 text-[15px] font-semibold">{draft.id ? 'Change this size' : 'A new size'}</p>
          <label className="mt-2 block text-[13px] font-semibold" style={muted}>Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="For example: Small mailer" className={input} style={style} /></label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(['lengthIn', 'widthIn', 'heightIn'] as const).map((k, i) => (
              <label key={k} className="block text-[13px] font-semibold" style={muted}>{['Length', 'Width', 'Height'][i]} (in)<input inputMode="decimal" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} className={input} style={style} /></label>))}
          </div>
          <label className="mt-2 block text-[13px] font-semibold" style={muted}>The empty box weighs (oz)<input inputMode="decimal" value={draft.weightOz} onChange={(e) => setDraft({ ...draft, weightOz: e.target.value })} className={input} style={style} /></label>
          <div className="mt-3 flex gap-2">
            <Btn kind="primary" className="h-11 flex-1" disabled={busy === 'save'} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save'}</Btn>
            <Btn kind="plain" className="h-11" onClick={() => { setDraft(null); setErr(''); }}>Cancel</Btn>
          </div>
        </div>
      ) : list.length < MAX_BOX_SIZES && <Btn kind="soft" className="mt-4 w-full" onClick={() => { setErr(''); setDraft({ ...blank }); }}>Add a size</Btn>}
      {err && <p role="alert" className="m-0 mt-3 text-[15px]" style={{ color: C.warn }}>{err}</p>}
      <p className="m-0 mt-3 text-[13px]" style={muted}>A box already chosen on an order keeps its size. Up to {MAX_BOX_SIZES} sizes.</p>
    </Sheet>);
}
