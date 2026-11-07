'use client';
// src/components/consents/FormBuilder.tsx — A FORM, BUILT IN PLAIN PIECES (board FormsBuilder, 16E). Settings › Forms
// and documents › a form. About it: its name, what kind it is (health questions are private and asked "anything
// changed?" later; a consent or release; anything else), whether it's asked once until its wording changes or at every
// visit, and whether a parent or guardian always signs. Then what it says and asks, in order: headings, wording,
// questions (a short or longer answer, one choice, several choices; each needs an answer or is optional), a photo, and a
// signature, each moved up or down or removed. Beside it, the form as clients see it, in the business's color (the same
// form screen the booking sheet and the visit link use). Saving gives changed wording a new version, so clients who
// signed before sign again at their next booking (lib/forms formVersion); a re-save of the same words keeps it.
// Deleting asks first and takes the form off the services that ask for it; what clients signed stays on their records.
import * as React from 'react';
import Link from 'next/link';
import { collection, doc, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { SettingsPage, Toggle } from '@/components/settings/settings-ui';
import { FormRunner, type Guardian } from '@/components/booking/FormRunner';
import { FLOW_CSS } from '@/components/booking/flow-css';
import { PUBLIC_CSS, moodStyle } from '@/components/public/kit';
import { studioPage } from '@/lib/studio-page';
import { formVersion, formMinutes, formRulesOf } from '@/lib/forms';

export type Kind = 'health' | 'consent' | 'other';
export type Piece = { id: string; type: string; label: string; options?: string[]; required?: boolean };
const QUESTION_KINDS = [{ value: 'short-text', label: 'A short answer' }, { value: 'long-text', label: 'A longer answer' }, { value: 'multiple-choice', label: 'One choice' }, { value: 'checkboxes', label: 'Several choices' }];
const isQuestion = (t: string) => QUESTION_KINDS.some((q) => q.value === t);
const rid = () => `f_${Math.random().toString(36).slice(2, 10)}`;
export const kindOf = (category: any): Kind => (category === 'Intake' ? 'health' : category === 'Waiver' || category === 'Release' ? 'consent' : 'other');
export const categoryFor = (kind: Kind, was?: any) => (kind === 'health' ? 'Intake' : kind === 'consent' ? (was === 'Release' ? 'Release' : 'Waiver') : (was && !['Intake', 'Waiver', 'Release'].includes(String(was)) ? String(was) : 'General'));
const PIECE_NAME: Record<string, string> = { heading: 'Heading', paragraph: 'Wording', 'image-upload': 'Photo', signature: 'Signature' };

/** What a form saves as, from the builder's draft. Each field keeps everything it had, with what was changed on top;
 *  a new piece left empty, or a new blank choice, is dropped; anything the form already had stays as it was, so a
 *  re-save of the same words keeps its version (lib/forms formVersion). A legacy plain-text form keeps its wording;
 *  a legacy "requires a signature" stays while a signature is among the pieces. */
export type Draft = { title: string; kind: Kind; every: boolean; guardian: boolean; pieces: Piece[]; impliedSig: boolean; content?: string | null; contentMoved?: boolean };
/** A field as the form had it (an older field without an id is matched by its place, as the builder named it). */
const originalOf = (orig: any[], id: string) => orig.find((f) => f?.id === id) || (/^field_\d+$/.test(id) && !orig[Number(id.slice(6))]?.id ? orig[Number(id.slice(6))] : undefined);
export function formPatch(d: Draft, was?: any): Record<string, any> {
  const orig: any[] = Array.isArray(was?.fields) ? was.fields.filter(Boolean) : [];
  const origOf = (id: string) => originalOf(orig, id);
  // A piece with no wording is kept only when the form already had it that way (a new or cleared one is stopped first).
  const fields = d.pieces.filter((p) => String(p.label || '').trim() || p.type === 'signature' || (origOf(p.id) && !String(origOf(p.id)?.label || '').trim())).map((p) => {
    const o = origOf(p.id); const label = String(p.label || '').trim();
    const f: any = { ...(o || {}), id: p.id, type: p.type, label: label || (p.type === 'signature' && !o ? 'Your signature' : '') };
    if (Array.isArray(p.options)) { const before: string[] = Array.isArray(o?.options) ? o.options.map(String) : []; f.options = p.options.map(String).filter((x) => x.trim() || before.includes(x)).map((x) => x.trim()); }
    if (p.required !== undefined) f.required = p.required; else delete f.required;
    return f;
  });
  return {
    title: d.title.trim(), category: categoryFor(d.kind, was?.category), fields,
    // "Asks for a signature" stays as it was while a signature is among the pieces (so a re-save asks no one to sign
    // again); with no signature left, it's off.
    requiresEveryAppointment: d.every, requiresGuardianSignature: d.guardian, requiresSignature: d.impliedSig || (!!was?.requiresSignature && fields.some((f: any) => f.type === 'signature')),
    // Wording turned into pieces leaves nothing behind that could come back.
    ...(d.content !== undefined && d.content !== null ? { content: d.content } : d.contentMoved ? { content: '' } : {}),
  };
}
/** What stops a save, in words (or null). */
/** A piece whose wording was cleared (it had some): stopped, so nothing is removed by accident. */
export function clearedPiece(pieces: Piece[], was?: any): Piece | null {
  const orig: any[] = Array.isArray(was?.fields) ? was.fields.filter(Boolean) : [];
  return pieces.find((p) => p.type !== 'signature' && !String(p.label || '').trim() && String(originalOf(orig, p.id)?.label || '').trim()) || null;
}
export function formProblem(p: Record<string, any>): string | null {
  if (!String(p.title || '').trim()) return 'Give the form a name.';
  if (!(p.fields || []).length && !String(p.content || '').trim() && !p.requiresSignature) return 'Add wording or a question first.';
  const choice = (f: any) => f?.type === 'multiple-choice' || f?.type === 'checkboxes';
  const few = (p.fields || []).find((f: any) => (f.type === 'multiple-choice' && (f.options || []).filter((o: string) => o.trim()).length < 2) || (f.type === 'checkboxes' && !(f.options || []).some((o: string) => o.trim())));
  if (few) return few.type === 'checkboxes' ? `“${few.label}” needs a choice to tick.` : `“${few.label}” needs at least two choices.`;
  const twice = (p.fields || []).filter(choice).find((f: any) => { const seen = (f.options || []).map((o: string) => o.trim().toLowerCase()).filter(Boolean); return new Set(seen).size !== seen.length; });
  if (twice) return `“${twice.label}” has the same choice twice.`;
  return null;
}

export function FormBuilderPage() {
  const { selectedTenant, can } = useTenant() as any; const { firestore } = useFirebase();
  const tenantId = String(selectedTenant?.id || '');
  const [want, setWant] = React.useState<{ id: string | null; fresh: boolean } | null>(null);
  React.useEffect(() => { const q = new URLSearchParams(window.location.search); setWant({ id: q.get('id'), fresh: q.get('new') === '1' }); }, []);
  const formQ = useMemoFirebase(() => (firestore && tenantId ? collection(firestore as Firestore, `tenants/${tenantId}/consentForms`) : null), [firestore, tenantId]);
  const svcQ = useMemoFirebase(() => (firestore && tenantId ? collection(firestore as Firestore, `tenants/${tenantId}/services`) : null), [firestore, tenantId]);
  const { data: forms, isLoading, error } = useCollection<any>(formQ);
  const { data: services } = useCollection<any>(svcQ);
  const mayEdit = typeof can === 'function' ? can('services.manage') : false;
  const made = React.useRef<string | null>(null);   // a form just made here (shown while it arrives)
  const keyOf = React.useRef<string | null>(null);   // one editor for this visit, so saving a new form keeps its place
  const last = React.useRef<any>(null);              // the form as last seen (kept on screen while it's being deleted)
  const deleting = React.useRef(false);
  if (error && want?.id) return <SettingsPage title="Form"><p className="text-[15px] cf-muted">This form couldn’t be loaded just now. Check your connection and try again.</p></SettingsPage>;
  if (!want || (want.id && (isLoading || !forms))) return <SettingsPage title="Form"><p className="cf-muted">Loading…</p></SettingsPage>;
  const found = want.id ? (forms || []).find((f: any) => f.id === want.id) || null : null;
  if (found) last.current = found;
  const form = found || (want.id && deleting.current ? last.current : null);
  if (keyOf.current === null) keyOf.current = want.id || 'new';
  if (want.id && !form && made.current !== want.id) return <SettingsPage title="Form"><p className="text-[15px] cf-muted">That form isn’t here anymore. <Link href="/settings/forms" className="underline underline-offset-2">Back to Forms and documents</Link></p></SettingsPage>;
  const usedBy = ((services || []) as any[]).filter((s) => s.status !== 'archived' && form && (s.requiredFormIds || []).map(String).includes(form.id));
  const save = async (patch: Record<string, any>): Promise<{ ok: boolean; id?: string; changed?: boolean }> => {
    if (!firestore || !tenantId || !mayEdit) return { ok: false };
    const nowIso = new Date().toISOString();
    try {
      // The form, or one just made here that hasn't arrived back yet (never a second copy).
      const target = form || (made.current ? { id: made.current } : null);
      if (target) {
        const version = formVersion({ ...target, ...patch }); const changed = !!form && version !== (form.version || formVersion(form));
        await updateDoc(doc(firestore as Firestore, `tenants/${tenantId}/consentForms/${target.id}`), { ...patch, version, ...(changed || !form ? { versionedAt: nowIso } : {}) });
        return { ok: true, id: target.id, changed };
      }
      const id = `form_${Math.random().toString(36).slice(2, 12)}`;
      await setDoc(doc(firestore as Firestore, `tenants/${tenantId}/consentForms/${id}`), { ...patch, id, isPasswordProtected: false, notifyOnEdit: false, version: formVersion(patch), versionedAt: nowIso, createdAt: nowIso });
      made.current = id; window.history.replaceState(null, '', `/settings/forms/form?id=${id}`); setWant({ id, fresh: false });
      return { ok: true, id, changed: false };
    } catch { return { ok: false }; }
  };
  // Deleted in one step with taking it off every service that asks for it (all of it happens, or none).
  const remove = async (): Promise<boolean> => {
    if (!firestore || !tenantId || !form || !mayEdit) return false;
    deleting.current = true;
    try {
      const b = writeBatch(firestore as Firestore);
      for (const s of (services || []) as any[]) if ((s.requiredFormIds || []).map(String).includes(form.id)) b.update(doc(firestore as Firestore, `tenants/${tenantId}/services/${s.id}`), { requiredFormIds: (s.requiredFormIds || []).filter((x: any) => String(x) !== form.id) });
      b.delete(doc(firestore as Firestore, `tenants/${tenantId}/consentForms/${form.id}`));
      await b.commit();
      window.location.assign('/settings/forms'); return true;
    } catch { deleting.current = false; return false; }
  };
  return <FormEditor key={keyOf.current} form={form} usedBy={usedBy} tenant={selectedTenant} tenantId={tenantId} canEdit={mayEdit} onSave={save} onDelete={remove} />;
}

const Label = ({ children }: { children: React.ReactNode }) => <p className="px-4 pb-2 text-[13px] font-semibold cf-muted">{children}</p>;
const Foot = ({ children }: { children: React.ReactNode }) => <p className="px-4 pt-2 text-[13px] leading-snug cf-muted">{children}</p>;
const iconBtn = 'grid h-11 w-11 flex-none place-items-center rounded-xl text-[16px] disabled:opacity-30';
const field = 'w-full rounded-[10px] border px-3 text-[15px] outline-none focus:border-[var(--ink)]';
const fieldStyle: React.CSSProperties = { background: 'var(--card)', borderColor: 'var(--line)', color: 'var(--ink)' };

/** The editor and the preview, for one form (or a new one). */
export function FormEditor({ form, usedBy, tenant, tenantId, canEdit, onSave, onDelete }: {
  form: any | null; usedBy: any[]; tenant: any; tenantId: string; canEdit: boolean;
  onSave: (patch: Record<string, any>) => Promise<{ ok: boolean; id?: string; changed?: boolean }>; onDelete: () => Promise<boolean>;
}) {
  // Every piece has its own id (an older field without one gets one by its place, so each edits on its own).
  const startFields: Piece[] = Array.isArray(form?.fields) ? form.fields.filter(Boolean).map((f: any, i: number) => ({ ...f, id: f.id || `field_${i}` })) : [];
  const [title, setTitle] = React.useState<string>(form?.title || '');
  const [kind, setKind] = React.useState<Kind>(form ? kindOf(form.category) : 'consent');
  const [every, setEvery] = React.useState<boolean>(!!form?.requiresEveryAppointment);
  const [guardian, setGuardian] = React.useState<boolean>(!!form?.requiresGuardianSignature);
  // An older form that asks for a signature without one among its pieces: shown as a signature piece of its own.
  const [impliedSig, setImpliedSig] = React.useState<boolean>(!!form?.requiresSignature && !startFields.some((f) => f.type === 'signature'));
  const [content, setContent] = React.useState<string | null>(!startFields.length && form?.content ? String(form.content) : null);
  const [pieces, setPieces] = React.useState<Piece[]>(startFields.length || form ? startFields : [{ id: rid(), type: 'heading', label: '' }, { id: rid(), type: 'paragraph', label: '' }]);
  const [busy, setBusy] = React.useState(false);
  const [said, setSaid] = React.useState<{ text: string; ok?: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const [newOpt, setNewOpt] = React.useState<Record<string, string>>({});
  const [contentMoved, setContentMoved] = React.useState(false);   // an older plain-text form's wording turned into pieces
  const previewBtn = React.useRef<HTMLButtonElement>(null); const sheet = React.useRef<HTMLDivElement>(null);
  // On a phone the preview opens over the page: focus goes into it, and back to Preview when it closes.
  const opened = React.useRef(false);
  React.useEffect(() => { if (preview) { opened.current = true; sheet.current?.focus(); } else if (opened.current) { opened.current = false; previewBtn.current?.focus(); } }, [preview]);
  const draft: Draft = { title, kind, every, guardian, pieces, impliedSig, content, contentMoved };
  const patch = formPatch(draft, form);
  const set = (id: string, p: Partial<Piece>) => { setPieces(pieces.map((x) => (x.id === id ? { ...x, ...p } : x))); setSaid(null); };
  const move = (i: number, by: number) => { const j = i + by; if (j < 0 || j >= pieces.length) return; const n = [...pieces]; [n[i], n[j]] = [n[j], n[i]]; setPieces(n); setSaid(null); };
  // An older plain-text form becomes pieces the moment one is added: its wording first, so nothing it said is lost.
  const add = (type: string) => { const lead: Piece[] = content !== null ? [{ id: rid(), type: 'paragraph', label: content }] : []; if (content !== null) { setContent(null); setContentMoved(true); } setPieces([...lead, ...pieces, { id: type === 'signature' ? 'signature' : rid(), type, label: type === 'signature' ? 'Your signature' : '', ...(isQuestion(type) || type === 'image-upload' ? { required: type !== 'image-upload' } : {}), ...(type === 'multiple-choice' ? { options: ['Yes', 'No'] } : {}) }]); setSaid(null); };
  // "Needs an answer": an older question with no setting counts as needed; turning it back on restores that, so a
  // re-save never asks anyone to sign again for nothing.
  const setNeeded = (p: Piece, on: boolean) => { const orig = startFields.find((f) => f.id === p.id); set(p.id, { required: on ? (orig && orig.required === undefined ? undefined : true) : false }); };
  const hasSig = impliedSig || pieces.some((p) => p.type === 'signature');
  const save = async () => {
    if (busy) return;
    // A choice typed but not yet added goes in with the save.
    const isChoice = (p: Piece) => p.type === 'multiple-choice' || p.type === 'checkboxes';
    const pending = pieces.some((p) => isChoice(p) && (newOpt[p.id] || '').trim());
    const ps = pending ? pieces.map((p) => (isChoice(p) && (newOpt[p.id] || '').trim() ? { ...p, options: [...(p.options || []), newOpt[p.id].trim()] } : p)) : pieces;
    if (pending) { setPieces(ps); setNewOpt({}); }
    const cleared = clearedPiece(ps, form);
    if (cleared) { setSaid({ text: `A ${isQuestion(cleared.type) ? 'question' : (PIECE_NAME[cleared.type] || 'piece').toLowerCase()} has no wording now. Add it back, or remove that ${isQuestion(cleared.type) ? 'question' : 'piece'}.` }); return; }
    const out = pending ? formPatch({ ...draft, pieces: ps }, form) : patch; const why = formProblem(out);
    if (why) { setSaid({ text: why }); return; }
    setBusy(true); const r = await onSave(out); setBusy(false);
    setSaid(r.ok ? { ok: true, text: r.changed ? `Saved. Clients who signed “${out.title}” before sign the new wording at their next booking.` : form ? 'Saved.' : `Saved. Add “${out.title}” to a service in Forms and documents to ask for it.` } : { text: 'That didn’t save. Check your connection and try again.' });
  };
  const previewForm = { id: form?.id || 'preview', ...patch };
  const look = studioPage(tenant || {});
  const mins = formMinutes(previewForm);

  return (
    <SettingsPage wide title={title.trim() || (form ? 'Untitled form' : 'New form')}
      help={usedBy.length ? `Used by ${usedBy.map((s) => s.name).slice(0, 3).join(', ')}${usedBy.length > 3 ? ` and ${usedBy.length - 3} more` : ''} · about ${mins} minute${mins === 1 ? '' : 's'} for a client` : `Not asked for by any service yet · about ${mins} minute${mins === 1 ? '' : 's'} for a client`}
      actions={<div className="flex gap-2">
        <button ref={previewBtn} type="button" onClick={() => setPreview(true)} className="h-12 rounded-full px-5 text-[15px] font-semibold lg:hidden" style={{ background: 'var(--soft)' }}>Preview</button>
        {canEdit && <button type="button" onClick={() => void save()} disabled={busy} className="h-12 rounded-full px-6 text-[15px] font-semibold disabled:opacity-50" style={{ background: 'var(--ink)', color: 'var(--card)' }}>{busy ? 'Saving…' : 'Save'}</button>}
      </div>}>
      <Link href="/settings/forms" className="-mt-4 inline-flex min-h-11 items-center text-[15px] cf-muted">‹ Forms and documents</Link>
      {said && <p role={said.ok ? 'status' : 'alert'} className="text-[14px]" style={{ color: said.ok ? 'var(--ok)' : 'var(--warn)' }}>{said.text}</p>}
      <div className="flex flex-col gap-9 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-7 lg:max-w-[680px]">
          <section aria-label="About this form">
            <Label>About this form</Label>
            <div className="overflow-hidden rounded-2xl" style={{ background: 'var(--soft)' }}>
              <label className="flex min-h-14 items-center gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid var(--line)' }}>
                <span className="flex-1 text-[17px]">Name</span>
                <input value={title} disabled={!canEdit} onChange={(e) => { setTitle(e.target.value); setSaid(null); }} maxLength={120} placeholder="Consent and release" className={`${field} h-11 max-w-[60%] sm:w-[280px]`} style={fieldStyle} />
              </label>
              <div className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid var(--line)' }}>
                <p className="flex-1 text-[17px]">What kind</p>
                <select aria-label="What kind of form" disabled={!canEdit} value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={`${field} h-11 w-auto sm:hidden`} style={fieldStyle}>
                  <option value="health">Health questions</option><option value="consent">Consent or release</option><option value="other">Other</option></select>
                <div role="radiogroup" aria-label="What kind" className="hidden rounded-full p-[3px] sm:inline-flex" style={{ background: 'color-mix(in srgb, var(--ink) 9%, transparent)' }}>
                  {([['health', 'Health questions'], ['consent', 'Consent or release'], ['other', 'Other']] as const).map(([v, l]) => (
                    <button key={v} type="button" role="radio" aria-checked={kind === v} tabIndex={kind === v ? 0 : -1} disabled={!canEdit} onClick={() => setKind(v)}
                      onKeyDown={(e) => { const order: Kind[] = ['health', 'consent', 'other']; const d = /^Arrow(Right|Down)$/.test(e.key) ? 1 : /^Arrow(Left|Up)$/.test(e.key) ? -1 : 0; if (!d) return; e.preventDefault(); const nx = order[(order.indexOf(kind) + d + 3) % 3]; setKind(nx); ((e.currentTarget.parentElement?.querySelector(`[data-kind="${nx}"]`)) as HTMLElement | null)?.focus(); }}
                      data-kind={v} className="min-h-11 whitespace-nowrap rounded-full px-3.5 text-[14px] font-semibold"
                      style={kind === v ? { background: 'var(--card)', color: 'var(--ink)', boxShadow: '0 1px 3px rgba(0,0,0,.08)' } : { color: 'var(--muted)' }}>{l}</button>))}
                </div>
              </div>
              <label className="flex min-h-14 items-center gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid var(--line)' }}>
                <span className="flex-1 text-[17px]">Asked</span>
                <select aria-label="Asked" disabled={!canEdit} value={every ? 'every' : 'once'} onChange={(e) => setEvery(e.target.value === 'every')} className={`${field} h-11 w-auto max-w-[60%]`} style={fieldStyle}>
                  <option value="once">Once, until its wording changes</option><option value="every">At every visit</option></select>
              </label>
              <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1"><p className="text-[17px]">A parent or guardian always signs</p><p className="mt-0.5 text-[13px] cf-muted">{formRulesOf(tenant).guardian ? 'Off: they’re asked only when someone signs for a person under 18' : 'Off: no one is asked about a guardian'}</p></div>
                <Toggle label="A parent or guardian always signs" disabled={!canEdit} checked={guardian} onChange={setGuardian} />
              </div>
            </div>
            <Foot>{kind === 'health' ? 'Health answers are seen only by people allowed to see health notes, and at later bookings clients are asked “anything changed?”' : 'A signed copy stays on the client’s record, with when and where they signed.'}</Foot>
          </section>

          <section aria-label="What it says and asks">
            <Label>What it says and asks</Label>
            <ol className="space-y-2.5">
              {content !== null && <li className="rounded-2xl border p-4" style={{ borderColor: 'var(--line)' }}>
                <p className="text-[12.5px] font-semibold cf-muted">Wording</p>
                <textarea aria-label="Wording" value={content} disabled={!canEdit} onChange={(e) => setContent(e.target.value)} rows={5} className={`${field} mt-1.5 py-2.5 leading-relaxed`} style={fieldStyle} />
              </li>}
              {pieces.map((p, i) => {
                const q = isQuestion(p.type); const name = q ? 'Question' : PIECE_NAME[p.type] || 'Piece';
                const needed = p.required !== false;
                return (
                  <li key={p.id} className="rounded-2xl border p-3.5 pl-4" style={{ borderColor: 'var(--line)' }}>
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 text-[12.5px] font-semibold cf-muted">{name}{(q || p.type === 'image-upload') && !needed ? ' · optional' : ''}</p>
                      {canEdit && <>
                        <button type="button" aria-label={`Move ${name.toLowerCase()} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)} className={iconBtn} style={{ background: 'var(--soft)' }}>↑</button>
                        <button type="button" aria-label={`Move ${name.toLowerCase()} ${i + 1} down`} disabled={i === pieces.length - 1} onClick={() => move(i, 1)} className={iconBtn} style={{ background: 'var(--soft)' }}>↓</button>
                        <button type="button" aria-label={`Remove ${name.toLowerCase()} ${i + 1}`} onClick={() => { setPieces(pieces.filter((x) => x.id !== p.id)); setSaid(null); }} className={iconBtn} style={{ background: 'var(--soft)', color: 'var(--muted)' }}>✕</button>
                      </>}
                    </div>
                    {p.type === 'paragraph'
                      ? <textarea aria-label={`Wording ${i + 1}`} value={p.label} disabled={!canEdit} onChange={(e) => set(p.id, { label: e.target.value })} rows={4} placeholder="What clients read" className={`${field} mt-2 py-2.5 leading-relaxed`} style={fieldStyle} />
                      : <input aria-label={`${name} ${i + 1}`} value={p.label} disabled={!canEdit} onChange={(e) => set(p.id, { label: e.target.value })}
                          placeholder={p.type === 'heading' ? 'A short heading' : q ? 'The question' : p.type === 'image-upload' ? 'What the photo should show' : 'Your signature'}
                          className={`${field} mt-2 h-11 ${p.type === 'heading' ? 'text-[17px] font-semibold' : ''}`} style={fieldStyle} />}
                    {q && <div className="mt-3 flex flex-wrap items-center gap-2.5">
                      <select aria-label="Kind of answer" disabled={!canEdit} value={p.type} onChange={(e) => set(p.id, { type: e.target.value, ...((e.target.value === 'multiple-choice' || e.target.value === 'checkboxes') && !(p.options || []).length ? { options: ['Yes', 'No'] } : {}) })} className={`${field} h-11 w-auto`} style={fieldStyle}>
                        {QUESTION_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
                      {(p.type === 'multiple-choice' || p.type === 'checkboxes') && (p.options || []).map((o, k) => (
                        <span key={k} className="inline-flex h-11 items-center gap-1 rounded-full pl-3.5" style={{ background: 'var(--soft)' }}>
                          <input aria-label={`${p.label || 'Question'}: choice ${k + 1}`} value={o} disabled={!canEdit} onChange={(e) => set(p.id, { options: (p.options || []).map((x, n) => (n === k ? e.target.value : x)) })} className="w-[7.5rem] bg-transparent text-[14px] outline-none" />
                          {canEdit && <button type="button" aria-label={`Remove choice ${o || k + 1}`} onClick={() => set(p.id, { options: (p.options || []).filter((_, n) => n !== k) })} className="grid h-11 w-11 place-items-center text-[13px] cf-muted">✕</button>}
                        </span>))}
                      {(p.type === 'multiple-choice' || p.type === 'checkboxes') && canEdit && <span className="inline-flex items-center gap-1">
                        <input aria-label="A new choice" value={newOpt[p.id] || ''} onChange={(e) => setNewOpt({ ...newOpt, [p.id]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && (newOpt[p.id] || '').trim()) { e.preventDefault(); set(p.id, { options: [...(p.options || []), newOpt[p.id].trim()] }); setNewOpt({ ...newOpt, [p.id]: '' }); } }} placeholder="Another choice" className={`${field} h-11 w-36`} style={fieldStyle} />
                        <button type="button" disabled={!(newOpt[p.id] || '').trim()} onClick={() => { set(p.id, { options: [...(p.options || []), (newOpt[p.id] || '').trim()] }); setNewOpt({ ...newOpt, [p.id]: '' }); }} className="min-h-11 px-2 text-[14px] font-semibold disabled:opacity-40">Add</button></span>}
                    </div>}
                    {(q || p.type === 'image-upload') && <div className="mt-2 flex items-center justify-end gap-2"><span className="text-[14px] cf-muted">Needs an answer</span><Toggle label={`${p.label || name}: needs an answer`} disabled={!canEdit} checked={needed} onChange={(v) => setNeeded(p, v)} /></div>}
                    {p.type === 'signature' && <p className="mt-1.5 text-[13px] cf-muted">They sign with a finger or type their name, and their full name is kept with it.</p>}
                  </li>);
              })}
              {impliedSig && <li className="flex items-start gap-2 rounded-2xl border p-3.5 pl-4" style={{ borderColor: 'var(--line)' }}>
                <div className="min-w-0 flex-1"><p className="text-[12.5px] font-semibold cf-muted">Signature</p><p className="mt-1.5 text-[15px]">Your signature</p><p className="mt-1 text-[13px] cf-muted">They sign with a finger or type their name, and their full name is kept with it.</p></div>
                {canEdit && <button type="button" aria-label="Remove signature" onClick={() => setImpliedSig(false)} className={iconBtn} style={{ background: 'var(--soft)', color: 'var(--muted)' }}>✕</button>}
              </li>}
            </ol>
            {canEdit && <div className="mt-3.5 flex flex-wrap gap-2">
              {([['heading', '+ Heading'], ['paragraph', '+ Wording'], ['short-text', '+ Question'], ['image-upload', '+ Photo'], ['signature', '+ Signature']] as const).map(([t, l]) => (
                <button key={t} type="button" disabled={t === 'signature' && hasSig} onClick={() => add(t)} className="min-h-11 rounded-full border border-dashed px-4 text-[14.5px] font-semibold disabled:opacity-40" style={{ borderColor: '#c9cacd', background: 'var(--card)' }}>{l}</button>))}
            </div>}
            <Foot>Changing the wording or a question asks clients who signed before to sign the new version at their next booking. What they signed before stays on their record.</Foot>
          </section>

          {form && canEdit && <section aria-label="Delete this form" className="pt-2">
            {!confirmDelete ? <button type="button" onClick={() => setConfirmDelete(true)} className="min-h-11 px-1 text-[15px] font-semibold" style={{ color: '#b42318' }}>Delete this form</button>
              : <div className="space-y-3 rounded-2xl p-4" style={{ background: 'var(--soft)' }}>
                  <p className="text-[15px]">Delete “{form.title || 'this form'}”?{usedBy.length ? ` ${usedBy.length === 1 ? `${usedBy[0].name} asks` : `${usedBy.length} services ask`} for it and will stop.` : ''} Forms clients already signed stay on their records.</p>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} onClick={async () => { setBusy(true); const ok = await onDelete(); setBusy(false); if (!ok) setSaid({ text: 'That didn’t delete. Check your connection and try again.' }); }} className="min-h-11 rounded-full px-5 text-[14.5px] font-semibold text-white disabled:opacity-50" style={{ background: '#b42318' }}>Delete it</button>
                    <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-11 rounded-full px-5 text-[14.5px] font-semibold" style={{ background: 'var(--card)' }}>Keep it</button>
                  </div></div>}
          </section>}
        </div>

        <aside aria-label="What clients see" role={preview ? 'dialog' : undefined} aria-modal={preview ? true : undefined} onKeyDown={(e) => { if (e.key === 'Escape' && preview) { e.stopPropagation(); setPreview(false); } }} className={preview ? 'fixed inset-0 z-40 overflow-y-auto p-4 lg:static lg:z-auto lg:p-0' : 'hidden lg:block'} style={preview ? { background: 'var(--soft)' } : undefined}>
          <div ref={sheet} tabIndex={-1} className="mx-auto w-full max-w-[400px] outline-none lg:sticky lg:top-6 lg:w-[390px]">
            <div className="flex items-center"><Label>What clients see</Label><span className="flex-1" />{preview && <button type="button" onClick={() => setPreview(false)} className="min-h-11 rounded-full px-4 text-[14px] font-semibold lg:hidden" style={{ background: 'var(--card)' }}>Close</button>}</div>
            <ClientPreview form={previewForm} tenant={tenant} tenantId={tenantId} accent={look.paint} mood={look.mood} onExit={() => setPreview(false)} exitLabel={preview ? 'Close the preview' : 'Start the preview again'} />
            <Foot>In your color, one screen at a time on a phone, saved as they go. Try it here: nothing is saved or sent.</Foot>
          </div>
        </aside>
      </div>
    </SettingsPage>);
}

/** The form exactly as clients get it (the booking sheet's and the visit link's form screen), in a phone-sized frame. */
function ClientPreview({ form, tenant, tenantId, accent, mood, onExit, exitLabel }: { form: any; tenant: any; tenantId: string; accent: string; mood: any; onExit?: () => void; exitLabel?: string }) {
  const [answers, setAnswers] = React.useState<Record<string, Record<string, any>>>({});
  const [guardians, setGuardians] = React.useState<Record<string, Guardian>>({});
  const [i, setI] = React.useState(0);
  return (
    <div className="pub overflow-hidden rounded-[28px]" data-mood={mood || 'soft'} style={{ ...(moodStyle(accent, mood || 'soft') as any), boxShadow: '0 0 0 1px var(--line), 0 24px 60px -30px rgba(22,23,26,.35)' }}>
      <style>{PUBLIC_CSS}{FLOW_CSS}</style>
      <div className="relative h-[720px]" style={{ background: 'var(--paper)' }}>
        <FormRunner inline forms={[form]} index={i} setIndex={setI} answers={answers} setAnswer={(fid, k, v) => setAnswers((a) => ({ ...a, [fid]: { ...(a[fid] || {}), [k]: v } }))}
          guardians={guardians} setGuardian={(fid, g) => setGuardians((x) => ({ ...x, [fid]: g }))} guardianAsk={formRulesOf(tenant).guardian}
          tenantId={tenantId} businessName={String(tenant?.name || '')} onClose={() => { setAnswers({}); setGuardians({}); onExit?.(); }} onFinish={() => { setAnswers({}); setGuardians({}); onExit?.(); }} backLabel={exitLabel || 'Start the preview again'} />
      </div>
    </div>);
}
