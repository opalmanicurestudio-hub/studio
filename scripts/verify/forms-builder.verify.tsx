// scripts/verify/forms-builder.verify.tsx — THE FORM BUILDER (B6d-2b, board FormsBuilder). A form in plain pieces:
// about it (name, kind, asked once or every visit, a guardian always signs), then headings, wording, questions (short,
// longer, one choice, several), a photo and a signature, moved and removed; beside it the form as clients see it. A
// re-save of the same words keeps its version (nobody signs again for nothing); changed words get a new one. It lives
// in Settings › Forms and documents; the old Agreements page and its sidebar entry send people there.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/forms-builder.verify.tsx
import Module from 'module';
import fs from 'fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as any).React = React;
let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 700) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
const M: any = Module as any; const load = M._load;
M._load = function (request: string, ...rest: any[]) {
  if (request === '@/context/TenantContext') return { useTenant: () => ({ selectedTenant: { id: 't1' }, can: () => true }), useTenantOptional: () => ({ selectedTenant: { id: 't1' } }) };
  if (request === '@/firebase') return { useFirebase: () => ({ firestore: {} }), useMemoFirebase: (fn: any) => fn(), useCollection: () => ({ data: [], isLoading: false }) };
  if (request === 'firebase/firestore') return { collection: () => null, doc: () => null, setDoc: async () => undefined, updateDoc: async () => undefined, deleteDoc: async () => undefined };
  if (request === '@/components/settings/settings-ui') return { SettingsPage: ({ title, help, actions, children }: any) => <main><h1>{title}</h1><p>{help}</p>{actions}{children}</main>, Toggle: ({ checked, label }: any) => <button role="switch" aria-checked={checked} aria-label={label} /> };
  if (request === 'next/link') return { __esModule: true, default: ({ href, children, className }: any) => <a href={href} className={className}>{children}</a> };
  return load.call(this, request, ...rest);
};

(async () => {
  const F = await import('../../src/lib/forms');
  const B = await import('../../src/components/consents/FormBuilder');

  // ── kinds
  ok(B.kindOf('Intake') === 'health' && B.kindOf('Release') === 'consent' && B.kindOf('Waiver') === 'consent' && B.kindOf('General') === 'other' && B.kindOf('Aftercare') === 'other', 'health questions, a consent or release, or other');
  ok(B.categoryFor('health') === 'Intake' && B.categoryFor('consent', 'Release') === 'Release' && B.categoryFor('consent', 'General') === 'Waiver' && B.categoryFor('other', 'Aftercare') === 'Aftercare' && B.categoryFor('other', 'Intake') === 'General', '…saved as the form’s category, keeping one of the business’s own');

  // ── re-saving the same words keeps the version
  const old = { id: 'c1', title: ' Consent and release ', category: 'Waiver', requiresSignature: true, fields: [
    { id: 'h', type: 'heading', label: 'Before your visit' }, { id: 'p', type: 'paragraph', label: 'I understand. ' },
    { id: 'q', type: 'multiple-choice', label: 'Contacts?', options: [' Yes', 'No '] }, { id: 's', type: 'signature', label: 'Signature' }] };
  const v0 = F.formVersion(old);
  const same = B.formPatch({ title: old.title, kind: 'consent', every: false, guardian: false, pieces: old.fields.map((f) => ({ ...f })) as any, impliedSig: false }, old);
  ok(F.formVersion({ ...old, ...same }) === v0, 'a re-save of the same words keeps the version (nobody signs again for nothing)', same);
  ok(!('required' in same.fields[2]) && same.requiresSignature === true && same.category === 'Waiver', '…an older question’s “needs an answer” and its signature setting stay as they were');
  const implied = { id: 'c2', title: 'Release', category: 'Release', requiresSignature: true, content: 'I agree to the terms.' };
  const p2 = B.formPatch({ title: 'Release', kind: 'consent', every: false, guardian: false, pieces: [], impliedSig: true, content: 'I agree to the terms.' }, implied);
  ok(F.formVersion({ ...implied, ...p2 }) === F.formVersion(implied) && p2.content === 'I agree to the terms.', 'an older plain-text form keeps its wording and signature');
  const changed = B.formPatch({ title: old.title, kind: 'consent', every: false, guardian: false, pieces: [...old.fields.map((f) => ({ ...f })), { id: 'x', type: 'short-text', label: 'Allergies?', required: true }] as any, impliedSig: false }, old);
  ok(F.formVersion({ ...old, ...changed }) !== v0, 'a new question is a new version');
  const nosig = B.formPatch({ title: 'X', kind: 'other', every: false, guardian: false, pieces: [{ id: 'p', type: 'paragraph', label: 'Words' }], impliedSig: false }, { requiresSignature: true });
  ok(nosig.requiresSignature === false, 'with the signature removed, it no longer asks for one');
  const cleaned = B.formPatch({ title: 'X', kind: 'other', every: true, guardian: true, pieces: [{ id: 'a', type: 'paragraph', label: '  ' }, { id: 'b', type: 'checkboxes', label: 'Which?', options: ['One', ' ', 'Two'] }, { id: 'signature', type: 'signature', label: '' }] as any, impliedSig: false });
  ok(cleaned.fields.length === 2 && cleaned.fields[0].options.join() === 'One,Two' && cleaned.fields[1].label === 'Your signature' && cleaned.requiresEveryAppointment === true && cleaned.requiresGuardianSignature === true, 'empty pieces and choices dropped; asked every visit; a guardian always signs', cleaned);

  const legacyPieces = () => legacy.fields.map((f) => ({ ...f })) as any;
  const legacy = { id: 'c3', title: 'Old', category: 'General', fields: [{ id: 'a', type: 'short-text', label: '' }, { id: 'b', type: 'checkboxes', label: 'I agree', options: ['I agree', ' '] }, { id: 's', type: 'signature', label: '', required: true }, { id: 'h', type: 'heading', label: 'Hi', options: ['x'], placeholder: 'kept' }] };
  const lp = B.formPatch({ title: 'Old', kind: 'other', every: false, guardian: false, pieces: legacy.fields.map((f) => ({ ...f })) as any, impliedSig: false }, legacy);
  ok(F.formVersion({ ...legacy, ...lp }) === F.formVersion(legacy) && (lp.fields[3] as any).placeholder === 'kept' && B.formProblem(lp) === null, 'an older form saves as it was: an empty question, a blank choice, a signature’s settings, its own extras (and one tick-box is fine)', lp.fields);
  const noId = { id: 'c4', title: 'Older', fields: [{ type: 'short-text', label: 'Name?', placeholder: 'kept' }, { type: 'paragraph', label: '' }] };
  const np = B.formPatch({ title: 'Older', kind: 'other', every: false, guardian: false, pieces: noId.fields.map((f, i) => ({ ...f, id: `field_${i}` })) as any, impliedSig: false }, noId);
  ok(np.fields.length === 2 && (np.fields[0] as any).placeholder === 'kept' && F.formVersion({ ...noId, ...np }) === F.formVersion(noId), 'an older field with no id is matched by its place (nothing of it is lost)', np.fields);
  ok(B.clearedPiece([{ id: 'q', type: 'multiple-choice', label: ' ' }] as any, old)?.id === 'q' && B.clearedPiece(legacyPieces(), legacy) === null, 'a question whose wording was cleared stops the save (one that was always blank doesn’t)');
  ok(B.formProblem({ title: 'A', fields: [{ type: 'short-text', label: 'Q', options: ['x', 'x'] }] }) === null, 'stray choices on a question that has none never block a save');
  const moved = B.formPatch({ title: 'Release', kind: 'consent', every: false, guardian: false, pieces: [{ id: 'p', type: 'paragraph', label: 'I agree to the terms.' }, { id: 'q', type: 'short-text', label: 'Initials?' }] as any, impliedSig: true, content: null, contentMoved: true }, implied);
  ok(moved.content === '' && moved.fields[0].label === 'I agree to the terms.', 'an older plain-text form’s wording moves into the pieces, and nothing is left behind');
  const one = B.formPatch({ title: 'X', kind: 'other', every: false, guardian: false, pieces: [{ id: 'n', type: 'checkboxes', label: 'Tick', options: ['Yes', '  '] }] as any, impliedSig: false });
  ok(one.fields[0].options.join() === 'Yes', 'a new blank choice is dropped');
  // ── what stops a save
  ok(B.formProblem({ title: '' }) === 'Give the form a name.' && B.formProblem({ title: 'A', fields: [] }) === 'Add wording or a question first.' && B.formProblem({ title: 'A', fields: [{ type: 'multiple-choice', label: 'Pick', options: ['One'] }] }) === '“Pick” needs at least two choices.' && B.formProblem({ title: 'A', fields: [{ type: 'checkboxes', label: 'Agree', options: [] }] }) === '“Agree” needs a choice to tick.' && B.formProblem({ title: 'A', fields: [{ type: 'multiple-choice', label: 'Pick', options: ['Yes', 'yes '] }] }) === '“Pick” has the same choice twice.' && B.formProblem(same) === null, 'what stops a save, in words');
  const fb = src('src/components/consents/FormBuilder.tsx');
  ok(/const lead: Piece\[\] = content !== null \? \[\{ id: rid\(\), type: 'paragraph', label: content \}\]/.test(fb) && /writeBatch\(/.test(fb) && /b\.delete\(/.test(fb) && /deleting\.current/.test(fb) && /isLoading \|\| !forms/.test(fb) && /A choice typed but not yet added goes in with the save/.test(fb), 'an older plain-text form keeps its wording when a piece is added; delete is one step; no flash while loading or deleting; a typed choice is saved');
  ok(/if \(demo\) \{ setShown\(dataUrl\); onChange\(dataUrl\); return; \}/.test(src('src/components/booking/FormRunner.tsx')) && /demo=\{inline\}/.test(src('src/components/booking/FormRunner.tsx')) && /nothing is saved or sent/.test(fb), 'a photo tried in the preview stays on the screen');
  ok(/hasSignature\(form\) && \(/.test(src('src/components/services/EditServiceDialog.tsx')) && /hasSignature\(form\) && \(/.test(src('src/components/services/BrowseConsentFormsDialog.tsx')), 'services show “signature” for any form with one');

  // ── the editor
  const html = renderToStaticMarkup(<B.FormEditor form={{ ...old, requiresSignature: false }} usedBy={[{ id: 's1', name: 'Lash lift' }, { id: 's2', name: 'Brow lamination' }]} tenant={{ name: 'Opal', timezone: 'America/Chicago' }} tenantId="t1" canEdit onSave={async () => ({ ok: true })} onDelete={async () => true} />);
  ok(/Consent and release/.test(html) && /Used by Lash lift, Brow lamination · about \d+ minutes? for a client/.test(html), 'its name, which services use it, and how long it takes', html.slice(0, 400));
  ok(/About this form/.test(html) && /aria-checked="true"[^>]*>Consent or release/.test(html) && /Once, until its wording changes/.test(html) && /A parent or guardian always signs/.test(html), 'about it: kind, how often, a guardian');
  ok(/What it says and asks/.test(html) && /One choice/.test(html) && /aria-label="Contacts\?: choice 1"/.test(html) && /Needs an answer/.test(html) && /Move heading 1 down/.test(html) && /Remove signature 4/.test(html), 'each piece, its answer kind and choices, needed or optional, moved or removed');
  ok(/\+ Heading/.test(html) && /\+ Wording/.test(html) && /\+ Question/.test(html) && /\+ Photo/.test(html) && /disabled=""[^>]*>\+ Signature/.test(html), 'add any piece (one signature)');
  ok(/What clients see/.test(html) && /data-form-runner=""/.test(html) && /role="group"/.test(html) && !/aria-modal/.test(html), 'beside it, the real form screen (inline, not a dialog)');
  ok(/Delete this form/.test(html) && /#b42318/.test(html), 'delete, in red (asks first)');
  const health = renderToStaticMarkup(<B.FormEditor form={{ id: 'h1', title: 'Health', category: 'Intake', fields: [{ id: 'q', type: 'long-text', label: 'Anything?' }] }} usedBy={[]} tenant={{}} tenantId="t1" canEdit onSave={async () => ({ ok: true })} onDelete={async () => true} />);
  ok(/Health answers are seen only by people allowed to see health notes/.test(health) && /Not asked for by any service yet/.test(health), 'health questions say who sees them');
  const fresh = renderToStaticMarkup(<B.FormEditor form={null} usedBy={[]} tenant={{}} tenantId="t1" canEdit onSave={async () => ({ ok: true })} onDelete={async () => true} />);
  ok(/New form/.test(fresh) && /placeholder="A short heading"/.test(fresh) && /placeholder="What clients read"/.test(fresh) && !/Delete this form/.test(fresh), 'a new form starts with a heading and wording');
  const view = renderToStaticMarkup(<B.FormEditor form={old} usedBy={[]} tenant={{}} tenantId="t1" canEdit={false} onSave={async () => ({ ok: true })} onDelete={async () => true} />);
  ok(!/>Save</.test(view) && !/\+ Heading/.test(view) && !/Delete this form/.test(view), 'someone who can’t change services sees it without changing it');

  // ── where it lives
  const page = src('src/app/(app)/settings/forms/form/page.tsx');
  ok(/^export default function \w+\(\) \{\n  return <FormBuilderPage \/>;\n\}/m.test(page) && !/^export (?!default)/m.test(page), 'Settings › Forms and documents › a form (the page exports only the page)');
  ok(/router\.replace\(id \? `\/settings\/forms\/form\?id=/.test(src('src/app/(app)/consents/page.tsx')) && !/'\/consents'/.test(src('src/components/shared/AppSidebar.tsx')), 'old Agreements links open it there; the sidebar entry is gone');
  ok(/href=\{`\/settings\/forms\/form\?id=\$\{encodeURIComponent\(f\.id\)\}`\}/.test(src('src/components/settings/FormsSettings.tsx')) && /\/settings\/forms\/form\?new=1/.test(src('src/components/settings/FormsSettings.tsx')), 'Forms and documents opens each form and a new one');
  ok(['AddConsentFormDialog', 'FieldEditor', 'PreviewConsentFormDialog', 'ConsentSignatureDialog'].every((f) => !fs.existsSync(`src/components/consents/${f}.tsx`)), 'the old builder is gone');
  ok(/inline\?: boolean/.test(src('src/components/booking/FormRunner.tsx')) && /role=\{inline \? 'group' : 'dialog'\}/.test(src('src/components/booking/FormRunner.tsx')), 'the form screen can sit inside a page');
  const all = [src('src/components/consents/FormBuilder.tsx'), page, src('src/app/(app)/consents/page.tsx')].join('\n');
  const tools = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  ok(!tools.test(all) && !/call us|contact us/i.test(all) && !/\{\/\*/.test(all) && !/uppercase|tracking-widest/.test(all) && !/cancell(ed|ing)/.test(all), 'house rules: no tool names, no "call us", no JSX comments, no all-caps labels, US spelling');
  console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
