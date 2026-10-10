'use client';
// /settings/roles — ROLES AND PERMISSIONS. Each role is a name and a list of what it allows (lib/permissions). The
// built-in roles work out of the box with names that fit the kind of business; the owner can rename them, change what
// they allow, or add their own (a shift lead, an educator, a stock lead). Everyone on a role gets the change straight
// away — on the app, the staff portal and the server.
import * as React from 'react';
import { getAuth } from 'firebase/auth';
import { Check, ChevronDown, Plus, Users } from 'lucide-react';
import { SettingsPage, Section, Toggle, cfInput, cfInputStyle } from '@/components/settings/settings-ui';
import { useTenant } from '@/context/TenantContext';
import { useInventory } from '@/context/InventoryContext';
import { useToast } from '@/hooks/use-toast';
import { CAPS, ALL_CAPS, BUILT_IN, NICHE_EXTRAS, rolesFor, type Cap } from '@/lib/permissions';

async function call(body: any) {
  const u = getAuth().currentUser; const tk = u ? await u.getIdToken() : '';
  const r = await fetch('/api/team/roles', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'Something went wrong.' }));
}

function RoleEditor({ id, def, count, canEdit, onDone, others }: { id: string | null; def: { name: string; caps: Cap[]; builtIn?: boolean; about?: string; base?: string }; count: number; canEdit: boolean; onDone: (msg?: string) => void; others: { id: string; name: string }[] }) {
  const { selectedTenant } = useTenant() as any; const { toast } = useToast();
  const [name, setName] = React.useState(def.name); const [caps, setCaps] = React.useState<Cap[]>(def.caps);
  const [busy, setBusy] = React.useState(false); const [moveTo, setMoveTo] = React.useState(def.base && def.base !== 'owner' ? def.base : 'staff');
  const owner = id === 'owner'; const locked = owner || !canEdit;
  const flip = (c: Cap, on: boolean) => setCaps((x) => (on ? [...new Set([...x, c])] : x.filter((y) => y !== c)));
  const run = async (body: any, ok: string) => {
    setBusy(true);
    try { const r = await call({ tenantId: selectedTenant?.id, ...body }); if (!r.ok) { toast({ variant: 'destructive', title: 'Not saved', description: r.error }); return; } onDone(ok + (r.synced ? ` ${r.synced} sign-in${r.synced === 1 ? '' : 's'} updated.` : '')); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-5 px-5 pb-5">
      {!owner && <label className="block space-y-1.5"><span className="text-[14px] font-medium">Name</span>
        <input className={cfInput} style={cfInputStyle} value={name} disabled={locked} onChange={(e) => setName(e.target.value)} maxLength={40} /></label>}
      {owner && <p className="text-[14px] cf-muted">The owner can always do everything, so nobody can lock the business out.</p>}
      {CAPS.map((g) => (
        <div key={g.group} className="space-y-1">
          <p className="text-[13px] font-semibold uppercase tracking-wide cf-muted">{g.group}</p>
          {g.items.map((it) => { const on = owner || caps.includes(it.id); return (
            <div key={it.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0"><p className="text-[15px]">{it.label}</p>{it.hint && <p className="text-[13px] cf-muted">{it.hint}</p>}</div>
              <Toggle checked={on} disabled={locked} label={it.label} onChange={(v) => flip(it.id, v)} />
            </div>); })}
        </div>))}
      {!locked && <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" disabled={busy || !name.trim()} onClick={() => run({ action: 'save', roleId: id || undefined, name: name.trim(), caps, base: def.base }, id ? 'Role saved.' : 'Role added.')}
          className="h-11 rounded-full px-5 text-[15px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>{id ? 'Save' : 'Add role'}</button>
        {id && def.builtIn && <button type="button" disabled={busy} onClick={() => run({ action: 'reset', roleId: id }, 'Back to how it started.')} className="h-11 rounded-full border px-5 text-[15px]" style={{ borderColor: 'var(--line)' }}>Reset</button>}
        {!id && <button type="button" onClick={() => onDone()} className="h-11 rounded-full border px-5 text-[15px]" style={{ borderColor: 'var(--line)' }}>Cancel</button>}
      </div>}
      {!locked && id && !def.builtIn && (
        <div className="space-y-2 rounded-2xl p-4" style={{ background: 'var(--soft)' }}>
          <p className="text-[14px] font-medium">Remove this role</p>
          {count > 0 && <label className="flex flex-wrap items-center gap-2 text-[14px]">Move its {count} {count === 1 ? 'person' : 'people'} to
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="h-10 rounded-xl border px-3 text-[14px]" style={cfInputStyle} aria-label="Role to move people to">
              {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></label>}
          <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Remove ${def.name}?`)) run({ action: 'delete', roleId: id, moveTo }, 'Role removed.'); }} className="h-10 rounded-full px-4 text-[14px] font-medium" style={{ color: '#B42318', border: '1px solid #F1C9C4' }}>Remove role</button>
        </div>)}
    </div>);
}

export default function RolesPage() {
  const { selectedTenant, role } = useTenant() as any; const inv: any = useInventory(); const { toast } = useToast();
  const team: any[] = (inv?.staff || []).filter((s: any) => !s.archived);
  const roles = React.useMemo(() => rolesFor(selectedTenant), [selectedTenant]);
  const canEdit = role === 'owner' || role === 'admin';
  const [open, setOpen] = React.useState<string | null>(null); const [adding, setAdding] = React.useState<{ name: string; caps: Cap[]; base?: string } | null>(null);
  const kind = String(selectedTenant?.businessType || selectedTenant?.category || '');
  const suggestions = (NICHE_EXTRAS[kind] || []).filter((x) => !roles[x.id]);
  const done = (msg?: string) => { setOpen(null); setAdding(null); if (msg) toast({ title: msg }); };
  const order = Object.keys(roles).sort((a, b) => (Number(!!roles[b].builtIn) - Number(!!roles[a].builtIn)) || (Object.keys(BUILT_IN).indexOf(a) - Object.keys(BUILT_IN).indexOf(b)));
  const others = (except: string) => order.filter((x) => x !== except && !['owner', 'admin', 'renter'].includes(x)).map((x) => ({ id: x, name: roles[x].name }));

  return (
    <SettingsPage title="Roles and permissions" help={`What each person on your team can see and do. Change a role and everyone on it gets the change straight away.${canEdit ? '' : ' (View only — the owner can change these.)'}`}
      actions={canEdit ? <button type="button" onClick={() => { setOpen(null); setAdding({ name: '', caps: BUILT_IN.staff.caps, base: 'staff' }); }} className="inline-flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold text-white" style={{ background: 'var(--accent)' }}><Plus className="h-4 w-4" aria-hidden />Add a role</button> : undefined}>
      {adding && <Section title="New role" help="Start from what a provider can do, then switch things on or off.">
        <div className="pt-4"><RoleEditor key={`new-${adding.name}`} id={null} def={adding} count={0} canEdit={canEdit} onDone={done} others={[]} /></div>
      </Section>}
      <Section title="Your roles" help="Tap a role to see or change what it allows.">
        {order.map((id) => { const d = roles[id]; const n = team.filter((s) => String(s.role || 'staff') === id).length; const isOpen = open === id;
          return (
            <div key={id} className="[&+&]:border-t" style={{ borderColor: 'var(--line)' }}>
              <button type="button" aria-expanded={isOpen} onClick={() => { setAdding(null); setOpen(isOpen ? null : id); }} className="flex w-full items-center gap-3 px-5 py-4 text-left">
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-semibold">{d.name}{!d.builtIn && <span className="ml-2 rounded-full px-2 py-0.5 text-[12px] font-medium" style={{ background: 'var(--soft)' }}>Your own</span>}</p>
                  <p className="text-[13.5px] cf-muted">{d.about ? `${d.about} · ` : ''}{id === 'owner' ? 'everything' : `${d.caps.length} of ${ALL_CAPS.length} permissions`}</p>
                </div>
                <span className="inline-flex items-center gap-1 text-[13.5px] cf-muted"><Users className="h-4 w-4" aria-hidden />{n}</span>
                <ChevronDown className={`h-5 w-5 cf-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
              </button>
              {isOpen && <RoleEditor id={id} def={d} count={n} canEdit={canEdit} onDone={done} others={others(id)} />}
            </div>); })}
      </Section>
      {canEdit && suggestions.length > 0 && <Section title="Suggested for your business" help="Roles businesses like yours often add. Add one, then adjust it.">
        {suggestions.map((x) => (
          <div key={x.id} className="flex items-center justify-between gap-3 px-5 py-4 [&+&]:border-t" style={{ borderColor: 'var(--line)' }}>
            <div className="min-w-0"><p className="text-[15px] font-medium">{x.def.name}</p><p className="text-[13.5px] cf-muted">Starts from {roles[x.def.base || 'staff']?.name || 'Provider'} · {x.def.caps.length} permissions</p></div>
            <button type="button" onClick={() => { setOpen(null); setAdding({ name: x.def.name, caps: x.def.caps, base: x.def.base }); }} className="inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-[14px] font-medium" style={{ borderColor: 'var(--line)' }}><Check className="h-4 w-4" aria-hidden />Use</button>
          </div>))}
      </Section>}
    </SettingsPage>);
}
