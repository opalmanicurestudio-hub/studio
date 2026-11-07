'use client';
// src/components/settings/FormsSettings.tsx — SETTINGS › FORMS AND DOCUMENTS (board FormsOwner). What each service needs
// from a client before the visit (its forms, documents and inspiration photos), when they're due and what happens if
// they aren't done, with what the client reads; the business's forms (opened in the form builder); how long a signature
// lasts and how health questions are asked; and whether each kind of document is kept on the client's profile. One
// place for each: a service's needs are its own fields (requiredFormIds, requiredFileRequirements, inspirationPhotos,
// formsRule, readiness.forms), the rest is tenant.formRules. Words and choices: lib/forms-settings.
import * as React from 'react';
import Link from 'next/link';
import { collection, doc, updateDoc, type Firestore } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { SettingsPage, Toggle } from '@/components/settings/settings-ui';
import { formRulesOf, formsRuleOf, asksInspirationPhotos, LASTS_CHOICES, type FormsDue } from '@/lib/forms';
import { DUE_CHOICES, IF_CHOICES, dueLabel, docTypesOf, needsLine, asksAnything, formKind, ifNotDoneOf, needsPatch, automationNote, ifNotDoneHelp, clientReads, type IfNotDone, type Decide } from '@/lib/forms-settings';

const rid = () => Math.random().toString(36).slice(2, 10);
const Chev = () => <span aria-hidden className="ml-0.5 h-2 w-2 flex-none rotate-45" style={{ borderRight: '2px solid #b9bbbf', borderTop: '2px solid #b9bbbf' }} />;
const Label = ({ children }: { children: React.ReactNode }) => <p className="px-4 pb-2 text-[13px] font-semibold cf-muted">{children}</p>;
const Foot = ({ children }: { children: React.ReactNode }) => <p className="px-4 pt-2 text-[13px] leading-snug cf-muted">{children}</p>;
const Group = ({ children, label }: { children: React.ReactNode; label: string }) => <div role="group" aria-label={label} className="overflow-hidden rounded-2xl" style={{ background: 'var(--soft)' }}>{children}</div>;
const Line = ({ children, last }: { children: React.ReactNode; last?: boolean }) => (
  <div className="flex min-h-14 items-center gap-3 pl-4"><div className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pr-4" style={last ? undefined : { borderBottom: '1px solid var(--line)' }}>{children}</div></div>);
function Select<T extends string | number>({ value, options, onChange, label, disabled, narrow }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; disabled?: boolean; narrow?: boolean }) {
  return (
    <select aria-label={label} disabled={disabled} value={String(value)} onChange={(e) => { const o = options.find((x) => String(x.value) === e.target.value); if (o) onChange(o.value); }}
      className={`h-11 min-w-0 rounded-[10px] border px-3 text-[15px] disabled:opacity-50 ${narrow ? 'max-w-[11.5rem]' : 'max-w-[11.5rem] sm:max-w-[15rem]'}`} style={{ background: 'var(--card)', borderColor: 'var(--line)', color: 'var(--ink)' }}>
      {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}</select>);
}
const Check = ({ on }: { on: boolean }) => on
  ? <span aria-hidden className="grid h-[22px] w-[22px] flex-none place-items-center rounded-md" style={{ background: 'var(--ink)' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--card)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg></span>
  : <span aria-hidden className="h-[22px] w-[22px] flex-none rounded-md" style={{ border: '2px solid #d4d4d8' }} />;

export function FormsSettings() {
  const { selectedTenant, can, role } = useTenant() as any; const { firestore } = useFirebase();
  const tenantId = String(selectedTenant?.id || '');
  const svcQ = useMemoFirebase(() => (firestore && tenantId ? collection(firestore as Firestore, `tenants/${tenantId}/services`) : null), [firestore, tenantId]);
  const formQ = useMemoFirebase(() => (firestore && tenantId ? collection(firestore as Firestore, `tenants/${tenantId}/consentForms`) : null), [firestore, tenantId]);
  const { data: svcData, isLoading: svcLoading } = useCollection<any>(svcQ);
  const { data: formData } = useCollection<any>(formQ);
  const services = React.useMemo(() => ((svcData || []) as any[]).filter((s) => s.type !== 'addon' && s.status !== 'archived' && s.archived !== true).sort((a, b) => String(a.name).localeCompare(String(b.name))), [svcData]);
  const forms = React.useMemo(() => ((formData || []) as any[]).filter((f) => f.archived !== true).sort((a, b) => String(a.title).localeCompare(String(b.title))), [formData]);
  const docTypes = React.useMemo(() => docTypesOf((svcData || []) as any[]), [svcData]);
  const mayServices = typeof can === 'function' ? can('services.manage') : false; const maySettings = String(role || '') === 'owner';   // the business's own record: the owner's to change
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState<{ text: string; ok?: boolean } | null>(null);
  const open = services.find((s) => s.id === openId) || null;

  const saveService = async (id: string, patch: Record<string, any>) => {
    if (!firestore || !tenantId) return false;
    try { await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}/services/${id}`), patch); return true; } catch { setSaid({ text: 'That didn’t save. Check your connection and try again.' }); return false; }
  };
  const fr = formRulesOf(selectedTenant);
  const saveRules = async (patch: any) => {
    if (!firestore || !tenantId || !maySettings) return;
    try { await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}`), { formRules: { ...fr, ...patch } }); setSaid({ text: 'Saved.', ok: true }); } catch { setSaid({ text: 'That didn’t save. Check your connection and try again.' }); }
  };
  // A kind of document kept on the client's profile (asked once) or asked for each visit: every service that asks for it.
  const saveDocKept = async (label: string, kept: boolean) => {
    if (!mayServices) return; const k = label.trim().toLowerCase(); let ok = true;
    for (const s of (svcData || []) as any[]) {
      const reqs: any[] = Array.isArray(s.requiredFileRequirements) ? s.requiredFileRequirements : [];
      if (!reqs.some((r) => String(r?.label || '').trim().toLowerCase() === k)) continue;
      ok = (await saveService(s.id, { requiredFileRequirements: reqs.map((r) => (String(r?.label || '').trim().toLowerCase() === k ? { ...r, persistToProfile: kept } : r)) })) && ok;
    }
    if (ok) setSaid({ text: 'Saved.', ok: true });
  };
  const formUses = (id: string) => ((svcData || []) as any[]).filter((s) => s.status !== 'archived' && (s.requiredFormIds || []).map(String).includes(id)).length;

  return (
    <SettingsPage wide title="Forms and documents" help="What each service needs from a client before the visit, and the forms they fill in.">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-7 lg:max-w-[640px]">
          {said && <p role={said.ok ? 'status' : 'alert'} className="px-1 text-[13.5px]" style={{ color: said.ok ? 'var(--ok)' : 'var(--warn)' }}>{said.text}</p>}
          <section aria-label="What each service needs">
            <Label>What each service needs</Label>
            <Group label="Services">
              {svcLoading && !services.length ? <Line last><p className="text-[15px] cf-muted">Loading your services…</p></Line>
                : !services.length ? <Line last><p className="text-[15px] cf-muted">Add a service first, then choose what it needs here.</p></Line>
                : services.map((s, i) => { const line = needsLine(s, forms); const any = asksAnything(s);
                  return (
                    <button key={s.id} type="button" onClick={() => { setOpenId(openId === s.id ? null : s.id); setSaid(null); }} aria-expanded={openId === s.id}
                      className="block w-full text-left" style={openId === s.id ? { background: 'color-mix(in srgb, var(--ink) 5%, transparent)' } : undefined}>
                      <Line last={i === services.length - 1}>
                        <div className="min-w-0 flex-1"><p className="text-[17px] tracking-[-0.01em]">{s.name}</p>{line && <p className="mt-0.5 text-[13px] leading-snug cf-muted">{line}</p>}</div>
                        <span className="whitespace-nowrap text-[15px] cf-muted">{any ? dueLabel(formsRuleOf(s).due) : 'Nothing'}</span><Chev />
                      </Line>
                    </button>); })}
            </Group>
            <Foot>Quick questions that can change the time and price are set in <Link href="/settings/before-the-visit" className="underline underline-offset-2">Before the visit</Link>.</Foot>
          </section>

          <section aria-label="Your forms">
            <Label>Your forms</Label>
            <Group label="Forms">
              {forms.map((f) => { const n = formUses(f.id);
                return (<Link key={f.id} href={`/consents?edit=${encodeURIComponent(f.id)}`} className="block"><Line>
                  <div className="min-w-0 flex-1"><p className="text-[17px] tracking-[-0.01em]">{f.title || 'Untitled form'}</p><p className="mt-0.5 text-[13px] cf-muted">{formKind(f)}</p></div>
                  <span className="whitespace-nowrap text-[15px] cf-muted">{n ? `${n} service${n === 1 ? '' : 's'}` : 'Not used yet'}</span><Chev />
                </Line></Link>); })}
              <Link href="/consents?new=1" className="block"><Line last><p className="flex-1 text-[17px] font-semibold">+ New form</p></Line></Link>
            </Group>
            <Foot>A form is made of headings, wording, questions, a photo and a signature. Change its wording and clients sign the new version at their next booking.</Foot>
          </section>

          <section aria-label="Signatures and answers">
            <Label>Signatures and answers</Label>
            <Group label="Signatures and answers">
              <Line><p className="flex-1 text-[17px]">A signed form lasts</p>
                <Select label="A signed form lasts" disabled={!maySettings} value={fr.lastsMonths} onChange={(v) => void saveRules({ lastsMonths: v })} options={LASTS_CHOICES.map((m) => ({ value: m as number, label: m === 0 ? 'Until its wording changes' : `Until its wording changes, or ${m} months` }))} /></Line>
              <Line><p className="flex-1 text-[17px]">Health questions</p>
                <Select label="Health questions" disabled={!maySettings} value={fr.health} onChange={(v) => void saveRules({ health: v })} options={[{ value: 'changed' as const, label: 'Ask “anything changed?” each booking' }, { value: 'every' as const, label: 'Ask them in full each booking' }]} /></Line>
              <Line last><div className="min-w-0 flex-1"><p className="text-[17px]">Signing for someone under 18</p><p className="mt-0.5 text-[13px] cf-muted">Asks for the guardian’s name and how they’re related</p></div>
                <Toggle label="Signing for someone under 18" disabled={!maySettings} checked={fr.guardian} onChange={(v) => void saveRules({ guardian: v })} /></Line>
            </Group>
            {!maySettings && <Foot>Only the owner can change these.</Foot>}
          </section>

          {docTypes.length > 0 && <section aria-label="Documents">
            <Label>Documents</Label>
            <Group label="Documents">
              {docTypes.map((d, i) => (
                <Line key={d.label} last={i === docTypes.length - 1}>
                  <div className="min-w-0 flex-1"><p className="text-[17px]">{d.label}</p><p className="mt-0.5 text-[13px] cf-muted">{d.services} service{d.services === 1 ? '' : 's'}</p></div>
                  <Select label={`${d.label}: kept or asked each visit`} disabled={!mayServices} value={d.kept ? 'kept' : 'each'} onChange={(v) => void saveDocKept(d.label, v === 'kept')}
                    options={[{ value: 'kept', label: 'Kept on the client’s profile' }, { value: 'each', label: 'Asked for each visit' }]} />
                </Line>))}
            </Group>
            <Foot>One kept on the profile is asked for once, then your team sees it on every visit.</Foot>
          </section>}
        </div>

        {open && <ServiceNeeds key={open.id} service={open} forms={forms} docTypes={docTypes} tenant={selectedTenant} canEdit={mayServices}
          onClose={() => setOpenId(null)} onSave={async (patch) => { if (!Object.keys(patch).length) return true; const ok = await saveService(open.id, patch); if (ok) setSaid({ text: `${open.name} saved.`, ok: true }); return ok; }} />}
      </div>
    </SettingsPage>);
}

/** One service: what it needs, when it's due, what happens if it isn't done, and what the client reads. Saved with Done. */
export function ServiceNeeds({ service, forms, docTypes, tenant, canEdit, onSave, onClose }: {
  service: any; forms: any[]; docTypes: { id: string; label: string; kept: boolean }[]; tenant: any; canEdit: boolean;
  onSave: (patch: Record<string, any>) => Promise<boolean>; onClose: () => void;
}) {
  const start = ifNotDoneOf(service, tenant);
  const [formIds, setFormIds] = React.useState<string[]>(Array.isArray(service.requiredFormIds) ? service.requiredFormIds.map(String) : []);
  const [files, setFiles] = React.useState<any[]>(Array.isArray(service.requiredFileRequirements) ? service.requiredFileRequirements : []);
  const [photos, setPhotos] = React.useState<boolean>(asksInspirationPhotos(service));
  const [due, setDue] = React.useState<FormsDue>(formsRuleOf(service).due);
  const [ifNot, setIfNot] = React.useState<IfNotDone>(start.ifNot);
  const [decide, setDecide] = React.useState<Decide>(start.decide);
  const [newDoc, setNewDoc] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { ref.current?.focus(); }, []);
  const key = (l: string) => l.trim().toLowerCase();
  const hasDoc = (label: string) => files.some((f) => key(String(f?.label || '')) === key(label));
  const toggleDoc = (d: { id: string; label: string; kept: boolean }) => setFiles(hasDoc(d.label) ? files.filter((f) => key(String(f?.label || '')) !== key(d.label))
    : [...files, { id: d.id || `filereq_${rid()}`, label: d.label, minCount: 1, maxCount: 5, persistToProfile: d.kept }]);
  // Every kind of document the business asks for, plus any this service has that no other does.
  const allDocs = [...docTypes, ...files.filter((f) => f?.label && !docTypes.some((d) => key(d.label) === key(String(f.label)))).map((f) => ({ id: String(f.id), label: String(f.label), kept: !!f.persistToProfile }))];
  const draft = { ...service, requiredFormIds: formIds, requiredFileRequirements: files, inspirationPhotos: photos ? 'optional' : 'off', formsRule: { due, release: ifNot === 'release' ? decide : 'off' }, readiness: { ...(service.readiness || {}), forms: ifNot === 'remind' ? 'remind' : 'block' } };
  const done = async () => {
    if (!canEdit) { onClose(); return; }
    setBusy(true);
    const ok = await onSave(needsPatch(service, tenant, { formIds, files, photos, due, ifNot, decide }));
    setBusy(false); if (ok) onClose();
  };
  return (<>
    <div aria-hidden onClick={onClose} className="fixed inset-0 z-30 lg:hidden" style={{ background: 'rgba(22,23,26,.35)' }} />
    <aside role="dialog" aria-label={`${service.name}: what it needs`} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }} className="fixed inset-x-0 bottom-0 z-40 max-h-[88vh] overflow-y-auto rounded-t-[22px] p-5 pb-8 lg:sticky lg:top-6 lg:inset-auto lg:z-auto lg:max-h-none lg:w-[380px] lg:flex-none lg:rounded-[22px] lg:p-[22px]"
      style={{ background: 'var(--card)', boxShadow: '0 0 0 1px var(--line), 0 24px 60px -30px rgba(22,23,26,.35)' }}>
      <div ref={ref} tabIndex={-1} className="flex items-center gap-3" style={{ outline: 'none', boxShadow: 'none' }}>
        <p className="min-w-0 flex-1 truncate text-[20px] font-semibold">{service.name}</p>
        <button type="button" onClick={() => void done()} disabled={busy} className="inline-flex min-h-11 items-center rounded-full px-5 text-[14px] font-semibold disabled:opacity-50" style={{ background: 'var(--ink)', color: 'var(--card)' }}>{busy ? 'Saving…' : canEdit ? 'Done' : 'Close'}</button>
      </div>
      <p className="mt-0.5 text-[13.5px] cf-muted">What a client needs before this service.</p>

      <div className="mt-5"><Label>Needs</Label>
        <Group label="Needs">
          {forms.map((f) => { const on = formIds.includes(f.id); return (
            <button key={f.id} type="button" role="checkbox" aria-checked={on} disabled={!canEdit} onClick={() => setFormIds(on ? formIds.filter((x) => x !== f.id) : [...formIds, f.id])} className="block w-full text-left disabled:opacity-60">
              <Line><Check on={on} /><p className="min-w-0 flex-1 text-[16px]">{f.title || 'Untitled form'}</p></Line></button>); })}
          {allDocs.map((d) => { const on = hasDoc(d.label); return (
            <button key={`d-${d.label}`} type="button" role="checkbox" aria-checked={on} disabled={!canEdit} onClick={() => toggleDoc(d)} className="block w-full text-left disabled:opacity-60">
              <Line><Check on={on} /><div className="min-w-0 flex-1"><p className="text-[16px]">{d.label}</p><p className="mt-0.5 text-[13px] cf-muted">{d.kept ? 'Kept on file, asked once' : 'Asked for each visit'}</p></div></Line></button>); })}
          <button type="button" role="checkbox" aria-checked={photos} disabled={!canEdit} onClick={() => setPhotos(!photos)} className="block w-full text-left disabled:opacity-60">
            <Line last={!canEdit}><Check on={photos} /><div className="min-w-0 flex-1"><p className="text-[16px]">Inspiration photos</p><p className="mt-0.5 text-[13px] cf-muted">Optional for the client</p></div></Line></button>
          {canEdit && <Line last>
            <input value={newDoc} onChange={(e) => setNewDoc(e.target.value)} maxLength={60} aria-label="Another document to ask for" placeholder="Another document, like a referral letter" className="h-11 min-w-0 flex-1 rounded-[10px] border px-3 text-[15px]" style={{ background: 'var(--card)', borderColor: 'var(--line)' }} />
            <button type="button" disabled={!newDoc.trim() || hasDoc(newDoc)} onClick={() => { setFiles([...files, { id: `filereq_${rid()}`, label: newDoc.trim(), minCount: 1, maxCount: 5, persistToProfile: /\bid\b|licen[cs]e|passport/i.test(newDoc) }]); setNewDoc(''); }}
              className="min-h-11 rounded-full px-4 text-[14px] font-semibold disabled:opacity-40" style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--line)' }}>Add</button>
          </Line>}
        </Group>
        {!forms.length && <Foot>No forms yet. <Link href="/consents?new=1" className="underline underline-offset-2">Make one</Link>.</Foot>}
      </div>

      {(formIds.length > 0 || files.length > 0) && <div className="mt-5"><Label>Rules</Label>
        <Group label="Rules">
          <Line><p className="flex-1 whitespace-nowrap text-[16px]">Due</p><Select narrow label="Due" disabled={!canEdit} value={due} onChange={setDue} options={DUE_CHOICES} /></Line>
          <Line last={ifNot !== 'release'}><p className="flex-1 whitespace-nowrap text-[16px]">If forms aren’t done</p><Select narrow label="If forms aren’t done" disabled={!canEdit} value={ifNot} onChange={setIfNot} options={IF_CHOICES} /></Line>
          {ifNot === 'release' && <div className="space-y-2 px-4 py-3"><p className="text-[16px]">Who decides</p>
            <div role="radiogroup" aria-label="Who decides" className="flex rounded-full p-[3px]" style={{ background: 'color-mix(in srgb, var(--ink) 9%, transparent)' }}>
              {([['auto', 'On its own'], ['ask', 'Ask me first']] as const).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={decide === v} disabled={!canEdit} onClick={() => setDecide(v)} className="min-h-11 flex-1 whitespace-nowrap rounded-full px-3.5 text-[14px] font-semibold"
                  style={decide === v ? { background: 'var(--card)', color: 'var(--ink)', boxShadow: '0 1px 3px rgba(0,0,0,.08)' } : { color: 'var(--muted)' }}>{l}</button>))}
            </div></div>}
        </Group>
        <Foot>{due === 'booking' ? 'Online, clients fill in the forms as they book, every time. A visit your team books has them due a day before. ' : ''}{ifNotDoneHelp(ifNot, decide, due)}</Foot>
        {automationNote(service, tenant) && <p className="mx-4 mt-2 rounded-[14px] px-3.5 py-3 text-[13.5px] leading-snug" style={{ background: 'color-mix(in srgb, var(--warn) 10%, var(--card))', color: 'var(--warn)' }}>{automationNote(service, tenant)}</p>}
      </div>}

      <div className="mt-5"><Label>What clients read</Label>
        <div className="rounded-2xl px-4 py-3.5" style={{ background: '#faf8f5', color: '#1c1917' }}>
          <p className="text-[13px] font-semibold" style={{ color: '#8b5e57' }}>Before your visit</p>
          <p className="mt-1.5 text-[14.5px] leading-relaxed">{clientReads(draft, forms, tenant)}</p>
        </div>
      </div>
      <button type="button" onClick={onClose} className="mt-4 min-h-11 w-full rounded-full text-[14px] font-medium cf-muted lg:hidden">Close without saving</button>
    </aside></>);
}
