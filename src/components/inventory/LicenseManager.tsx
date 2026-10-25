'use client';
// src/components/inventory/LicenseManager.tsx — THE SHOP'S LICENSES, made once and picked on every download
// (lib/licenses). Each license is a few plain choices plus a note, and its words are written from them, so buyers read
// the same kind of sentence whichever license it is. Saved on the shop (owners only); a change applies to new sales,
// never to what someone already bought.
import * as React from 'react';
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { Btn, C, Sheet, muted } from '@/components/orders/ui';
import { MAX_OWN_LICENSES, cleanUses, licensesOf, newLicenseId, termsOf, type LicensePolicy } from '@/lib/licenses';

const field: React.CSSProperties = { borderRadius: 12, border: `1px solid ${C.line}`, background: '#fff', color: C.ink };

export function LicenseManager({ tenantId, tenant, onClose, onPicked }: { tenantId: string; tenant: any; onClose: () => void; onPicked?: (id: string) => void }) {
  const { firestore } = useFirebase() as any;
  const { toast } = useToast();
  const [list, setList] = React.useState<LicensePolicy[]>(() => licensesOf(tenant));
  const [edit, setEdit] = React.useState<LicensePolicy | null>(null);
  const [busy, setBusy] = React.useState(false);

  const persist = async (next: LicensePolicy[]) => {
    if (!firestore || !tenantId) return false;
    setBusy(true);
    try {
      // Saved: the shop's own licenses, and a ready-made one only when its words were changed.
      const saved = next.filter((l) => !l.builtIn || l.note || JSON.stringify(cleanUses(l.uses)) !== JSON.stringify(cleanUses(licensesOf({}).find((b) => b.id === l.id)?.uses)))
        .map((l) => ({ id: l.id, name: l.name.trim().slice(0, 60), note: l.note.trim().slice(0, 600), uses: cleanUses(l.uses) }));
      await updateDoc(doc(firestore as Firestore, 'tenants', tenantId), { digitalLicenses: saved });
      setList(licensesOf({ digitalLicenses: saved }));
      return true;
    } catch {
      toast({ variant: 'destructive', title: 'Not saved', description: 'Only the shop’s owner can change its licenses.' });
      return false;
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { toast({ variant: 'destructive', title: 'Give the license a name' }); return; }
    const exists = list.some((l) => l.id === edit.id);
    const next = exists ? list.map((l) => (l.id === edit.id ? edit : l)) : [...list, edit];
    if (await persist(next)) { setEdit(null); if (!exists) onPicked?.(edit.id); }
  };

  const remove = async (id: string) => { if (await persist(list.filter((l) => l.id !== id))) setEdit(null); };

  if (edit) {
    const u = edit.uses;
    const setU = (p: Partial<typeof u>) => setEdit({ ...edit, uses: { ...u, ...p } });
    const check = (key: 'clients' | 'commercial' | 'modify' | 'resale', label: string) => (
      <label className="flex min-h-11 items-center gap-3 text-[15px]"><input type="checkbox" checked={u[key]} onChange={(e) => setU({ [key]: e.target.checked } as any)} className="h-5 w-5" />{label}</label>
    );
    return (
      <Sheet title={edit.builtIn ? edit.name : list.some((l) => l.id === edit.id) ? 'Change license' : 'New license'} sub="Changes apply to new sales. Past buyers keep the words they bought with." onClose={() => setEdit(null)} closeLabel="Back">
        <div className="flex flex-col gap-4">
          {!edit.builtIn && (
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold" style={muted}>Name
              <input value={edit.name} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="For example, Salon license" className="h-11 px-3 text-[15px] font-normal" style={field} />
            </label>
          )}
          <fieldset className="flex flex-col">
            <legend className="mb-1 text-[13px] font-semibold" style={muted}>Buyers may</legend>
            {check('clients', 'Use it in their work with clients')}
            {check('commercial', 'Sell things they make with it')}
            {check('modify', 'Change it for their own use')}
            {check('resale', 'Resell or share the files themselves')}
            <label className="flex min-h-11 items-center gap-3 text-[15px]">People in their business who may use it
              <input inputMode="numeric" value={String(u.seats)} onChange={(e) => setU({ seats: Math.max(1, Math.min(999, Number(e.target.value.replace(/\D/g, '')) || 1)) })} aria-label="People who may use it" className="h-11 w-20 px-3 text-center text-[15px]" style={field} />
            </label>
          </fieldset>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold" style={muted}>Anything else (optional)
            <textarea value={edit.note} maxLength={600} onChange={(e) => setEdit({ ...edit, note: e.target.value })} rows={3} placeholder="For example, credit Opal Studio when you share work made with it." className="px-3 py-2 text-[15px] font-normal" style={field} />
          </label>
          <div className="rounded-2xl p-4" style={{ background: C.soft }}>
            <p className="m-0 text-[13px] font-semibold" style={muted}>What buyers read</p>
            <p className="m-0 mt-1 text-[15px] leading-relaxed">{termsOf(edit)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn kind="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save license'}</Btn>
            {!edit.builtIn && list.some((l) => l.id === edit.id) && (
              <button type="button" onClick={() => void remove(edit.id)} disabled={busy} className="h-11 rounded-full px-4 text-[15px] font-semibold" style={{ color: '#b42318' }}>Remove</button>
            )}
          </div>
          {!edit.builtIn && list.some((l) => l.id === edit.id) && <p className="m-0 text-[13px]" style={muted}>Removing it keeps its words on products already using it until you pick another.</p>}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Your licenses" sub="Pick one on each download. Buyers see its words when they open what they bought." onClose={onClose} closeLabel="Done">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {list.map((l) => (
          <li key={l.id}>
            <button type="button" onClick={() => setEdit({ ...l, uses: { ...l.uses } })} className="flex w-full flex-col gap-1 rounded-2xl p-4 text-left" style={{ border: `1px solid ${C.line}`, background: '#fff', color: C.ink }}>
              <span className="text-[15px] font-semibold">{l.name}{l.builtIn ? <span className="ml-2 text-[13px] font-normal" style={muted}>Ready-made</span> : null}</span>
              <span className="text-[13px] leading-relaxed" style={muted}>{termsOf(l)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        {list.filter((l) => !l.builtIn).length >= MAX_OWN_LICENSES ? <p className="m-0 text-[13px]" style={muted}>That’s the most licenses a shop can keep. Remove one to add another.</p> : <Btn onClick={() => setEdit({ id: newLicenseId(), name: '', note: '', uses: { clients: false, commercial: false, modify: true, resale: false, seats: 1 } })}>New license</Btn>}
      </div>
    </Sheet>
  );
}
