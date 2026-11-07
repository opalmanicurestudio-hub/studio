// scripts/verify/booking-forms.verify.tsx — FORMS INSIDE THE BOOKING SHEET (B6b, board FormsBook). The details step
// lists what the visit needs before it ("Before your visit · about 2 minutes"): each form with how long it takes and a
// tick when done, any document the service asks for (asked on the visit link, where it stays private), and "Do them
// now / Later, from my visit link". A form opens over the sheet, one at a time: chips for choices, big tick rows, the
// wording with "Read all of it", a typed name and a finger signature, "I'm signing for someone under 18" with the
// guardian, and a lock line on health forms. Only finished forms are sent; the visit link asks for the rest.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/booking-forms.verify.tsx
import fs from 'fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as any).React = React;
let bad = 0; const ok = (c: any, m: string, x?: any) => { if (!c) { bad++; console.error('FAIL', m, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  const R = await import('../../src/components/booking/FormRunner');
  const health = { id: 'h1', title: 'Health and allergy questions', category: 'Intake', fields: [
    { id: 'q1', type: 'checkboxes', label: 'Do any of these apply to you?', options: ['Diabetes', 'None of these'] },
    { id: 'q2', type: 'multiple-choice', label: 'Any skin conditions on your hands?', options: ['Yes', 'No'] },
    { id: 'q3', type: 'short-text', label: 'Any medications we should know about?', required: false } ] };
  const consent = { id: 'c1', title: 'Consent and release', category: 'Waiver', fields: [{ id: 'p', type: 'paragraph', label: 'I understand. '.repeat(40) }, { id: 's', type: 'signature', label: 'Your signature' }] };
  const plain = { id: 'w1', title: 'Waiver', content: 'Some words.', requiresSignature: true };

  // ── what's left on a form, and how long it takes (lib/forms: the same rule the server checks)
  const SIG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(10);
  ok(R.formLeft(health, {}) === 2 && R.formLeft(health, { q1: ['None of these'], q2: 'No' }) === 0, 'every question, except one marked optional, needs an answer');
  ok(R.formLeft(health, { q1: ['None of these'], q2: '   ' }) === 1, 'an answer of only spaces isn’t an answer');
  ok(R.formLeft(consent, { s: SIG }) === 1 && R.formLeft(consent, { s: SIG, __signedName: 'Dana Reyes' }) === 0, 'a signature also needs the signer’s full name');
  ok(R.formLeft(consent, { s: SIG, __signedName: 'Dana' }, { on: true, name: 'Ana', relationship: '' }) === 1 && R.formLeft(consent, { s: SIG, __signedName: 'Dana' }, { on: true, name: 'Ana', relationship: 'Mother' }) === 1
    && R.formLeft(consent, { s: SIG, __signedName: 'Dana' }, { on: true, name: 'Ana', relationship: 'Mother', consent: true }) === 0, 'signing for someone under 18 needs the guardian’s name, how they’re related, and their consent');
  ok(R.formLeft({ ...consent, requiresGuardianSignature: true }, { s: SIG, __signedName: 'Dana' }, null) === 1, 'a form that always needs a guardian asks even without the switch');
  const kidHealth = { ...health, requiresGuardianSignature: true };
  ok(R.formLeft(kidHealth, { q1: ['None of these'], q2: 'No' }, null) === 1 && R.formLeft(kidHealth, { q1: ['None of these'], q2: 'No' }, { on: true, name: 'Ana', relationship: 'Mother', consent: true }) === 0, 'a guardian form with no signature still needs the guardian');
  ok(R.formLeft(consent, { s: 'data:,', __signedName: 'Dana' }) === 1 && R.formLeft(consent, { s: 'x', __signedName: 'Dana' }) === 1 && R.formLeft(consent, { s: 'typed:', __signedName: 'Dana' }) === 1
    && R.formLeft(consent, { s: 'typed:Dana Reyes', __signedName: 'Dana Reyes' }) === 0, 'a blank pad or a stray value is no signature; a drawn or typed one is');
  ok(R.fieldsOf(plain).map((f) => `${f.id}:${f.type}`).join() === 'content:paragraph,signature:signature' && R.hasSignature(plain), 'a form with only wording gets its wording and a signature (plain ids)');
  const readOnly = { id: 'r1', title: 'Our policies', content: 'Be kind.' };
  ok(R.wordingOnly(readOnly) && R.formLeft(readOnly, {}) === 1 && R.formLeft(readOnly, { __read: true }) === 0, 'a form with only wording asks “I’ve read this”');
  const allOptional = { id: 'o1', title: 'A little about you', fields: [{ id: 'n', type: 'short-text', label: 'Nickname?', required: false }] };
  ok(R.formLeft(allOptional, {}) === 1 && R.formLeft(allOptional, { __seen: true }) === 0, 'a form that requires nothing is done only once it’s been opened');
  ok(R.fieldsOf({ ...health, requiresSignature: true }).slice(-1)[0]?.type === 'signature' && R.formLeft({ id: 'u', fields: [{ id: 'z', type: 'date', label: 'When?' }] }, {}) === 1, 'a form that asks for a signature gets one; a question of any other kind still counts');
  ok(R.formMinutes(health) === 1 && R.formMinutes({ ...consent, fields: [{ id: 'p', type: 'paragraph', label: 'word '.repeat(600) }, consent.fields[1]] }) >= 3, 'about how long each takes, from its questions and its words');

  // ── the server checks each form it's sent, by the same rule
  const F = await import('../../src/lib/forms');
  const odd = { id: 'u1', title: 'Odd ids', fields: [{ id: '__k3Zq', type: 'short-text', label: 'Anything else?' }] };
  const sent = Object.fromEntries(Object.entries({ __k3Zq: 'No', __seen: true, __signedName: '' }).filter(([k]) => !F.FORM_META.has(k)));
  ok(R.formLeft(odd, { __k3Zq: 'No' }) === 0 && JSON.stringify(sent) === '{"__k3Zq":"No"}' && F.sentFormDone(odd, { formData: sent }), 'a question whose own id starts with "__" keeps its answer all the way to the server');
  ok(F.sentFormDone(consent, { formData: { s: SIG }, signedName: 'Dana Reyes' }) && !F.sentFormDone(consent, { formData: {} }) && !F.sentFormDone(consent, { formData: { s: SIG } }) && !F.sentFormDone(consent, { formData: { s: 'nope' }, signedName: 'Dana' }), 'a form sent with nothing in it, no name, or no real signature doesn’t count');
  ok(!F.sentFormDone({ ...consent, requiresGuardianSignature: true }, { formData: { s: SIG }, signedName: 'Dana' }) && !F.sentFormDone({ ...consent, requiresGuardianSignature: true }, { formData: { s: SIG }, signedName: 'Dana', guardian: { name: 'Ana', relationship: 'Mother' } })
    && F.sentFormDone({ ...consent, requiresGuardianSignature: true }, { formData: { s: SIG }, signedName: 'Dana', guardian: { name: 'Ana', relationship: 'Mother', confirmed: true } }), 'a guardian form counts only with a guardian who said they agree');
  ok(!F.sentFormDone(readOnly, { formData: {} }) && F.sentFormDone(readOnly, { formData: {}, acknowledged: true }) && F.sentFormDone(allOptional, { formData: {} }), '“I’ve read this” is sent and checked; a form that requires nothing counts once sent');
  ok(F.sentFormDone(consent, { formData: { s: SIG }, signedName: 'Dana', guardian: { name: 'Ana', relationship: 'Mother', confirmed: true } }, { lastsMonths: 12, health: 'changed', guardian: true }), 'an optional guardian on a form that doesn’t need one is fine');

  // ── one form at a time, in the sheet's look
  const html = renderToStaticMarkup(<R.FormRunner forms={[health, consent]} index={0} setIndex={() => {}} answers={{}} setAnswer={() => {}} guardians={{}} setGuardian={() => {}} guardianAsk tenantId="t1" businessName="Opal Manicure Studio" onClose={() => {}} />);
  ok(/Form 1 of 2 · about 1 minute</.test(html) && !/saved as you go/.test(html) && /role="radiogroup"/.test(html) && /role="radio" aria-checked="false" tabindex="0" class="cf-chip cf-chip-text"/.test(html) && /role="radio" aria-checked="false" tabindex="-1"/.test(html)
    && /Your answers are kept private to Opal Manicure Studio\./.test(html) && /2 things left/.test(html) && /\(optional\)/.test(html), 'counted, one-choice answers as radio chips with one tab stop, optional questions marked, health answers kept private, and how many things are left');
  ok(/white-space:normal/.test(html) && /role="group" aria-labelledby="fr-title"/.test(html) && /aria-live="polite"/.test(html), 'long choices wrap; a new form is announced; what’s left is read out');
  const html2 = renderToStaticMarkup(<R.FormRunner forms={[health, consent]} index={1} setIndex={() => {}} answers={{ c1: { s: SIG, __signedName: 'Dana' } }} setAnswer={() => {}} guardians={{}} setGuardian={() => {}} guardianAsk tenantId="t1" businessName="Opal" onClose={() => {}} />);
  ok(/Read all of it/.test(html2) && /I’m signing for someone under 18/.test(html2) && /role="switch"/.test(html2) && />Done</.test(html2) && !/kept private/.test(html2) && !/Type it instead/.test(html2), 'the wording with “Read all of it”, the under-18 switch, and Done on the last form');
  const html3 = renderToStaticMarkup(<R.FormRunner forms={[consent]} index={0} setIndex={() => {}} answers={{}} setAnswer={() => {}} guardians={{}} setGuardian={() => {}} guardianAsk={false} tenantId="t1" businessName="Opal" onClose={() => {}} />);
  ok(!/under 18/.test(html3), 'no under-18 switch when the business doesn’t ask');
  ok(html2.indexOf('Full name') > 0 && html2.indexOf('Full name') < html2.indexOf('alt="Your signature"') && html3.indexOf('Full name') < html3.indexOf('Signature pad') && html2.indexOf('Read all of it') < html2.indexOf('Full name'), 'the name and the under-18 switch come just before the signature, after the wording');
  const html4 = renderToStaticMarkup(<R.FormRunner forms={[{ ...consent, requiresGuardianSignature: true }]} index={0} setIndex={() => {}} answers={{}} setAnswer={() => {}} guardians={{}} setGuardian={() => {}} guardianAsk={false} tenantId="t1" businessName="Opal" onClose={() => {}} />);
  ok(/Their full name/.test(html4) && /A parent or guardian completes this form\./.test(html4) && /I’m their parent or legal guardian, and I agree to this form for them\./.test(html4) && !/role="switch"/.test(html4) && /Type it instead \(add the full name first\)/.test(html4), 'a guardian form: their name, the guardian’s details and consent, no switch; a signature can be typed');
  const html4b = renderToStaticMarkup(<R.FormRunner forms={[{ ...consent, requiresGuardianSignature: true }]} index={0} setIndex={() => {}} answers={{ c1: { __signedName: 'Mia Reyes' } }} setAnswer={() => {}} guardians={{ c1: { on: true, name: 'Ana Reyes', relationship: 'Mother', consent: true } }} setGuardian={() => {}} guardianAsk={false} tenantId="t1" businessName="Opal" onClose={() => {}} />);
  ok(/>Type it instead</.test(html4b) && !/disabled="" class="cf-link mt-1/.test(html4b), 'a guardian types the signature in their own name');
  const html5 = renderToStaticMarkup(<R.FormRunner forms={[readOnly]} index={0} setIndex={() => {}} answers={{}} setAnswer={() => {}} guardians={{}} setGuardian={() => {}} guardianAsk tenantId="t1" businessName="Opal" onClose={() => {}} />);
  ok(/I’ve read this/.test(html5) && /1 thing left/.test(html5) && !/Full name/.test(html5), 'a form with only wording: “I’ve read this”, no name or signature');
  const fr = src('src/components/booking/FormRunner.tsx');
  ok(/'\/api\/booking\/photo'/.test(fr) && !/ImageUpload/.test(fr) && /That photo is too large\. Choose one under 25 MB\./.test(fr), 'a photo on a form goes through the server, with a plain message when it’s too large');
  ok(/c\.isEmpty\?\.\(\)\) return/.test(fr) && /url !== 'data:,'/.test(fr) && /value && !fresh/.test(fr) && /penColor="#16171a"/.test(fr) && /background: '#fff'/.test(fr) && /aria-label="Close the form"/.test(fr) && /e\.key === 'Escape'/.test(fr), 'a white pad with dark ink in every look; closes with the button or Escape');
  ok(/key=\{form\.id\}/.test(fr) && /key=\{`\$\{form\.id\}:\$\{f\.id \|\| i\}`\}/.test(fr), 'each form gets its own fields and pad (nothing carries over from the last form)');
  ok(/const signer = forChild \? g\.name : /.test(fr) && /clearTyped\(\)/.test(fr) && /'__seen', true/.test(fr), 'a typed signature is in the signer’s name and cleared when that changes; opening a form marks it seen');

  // ── the booking sheet
  const bs = src('src/components/booking/BookingSheet.tsx');
  ok(/formsAskedFor\(\{\}, \[service, \.\.\.addOns\.filter/.test(bs), 'the forms of the service and of any chosen add-on');
  ok(/requiredForms\.filter\(formDone\)/.test(bs) && /!FORM_META\.has\(k\)/.test(bs) && /signedName \? \{ signedName \}/.test(bs) && /a\.__read === true \? \{ acknowledged: true as const \}/.test(bs) && /guardianSigns\(form, g, guardianAsk\) && g\?\.consent === true \? \{ guardian: \{ name: g\.name\.trim\(\), relationship: g\.relationship\.trim\(\), confirmed: true \} \}/.test(bs), 'only finished forms are sent: the answers, the name it was signed in, “I’ve read this”, and the guardian who consented');
  ok(/formsWhen === 'now' \|\| toBook \? requiredForms\.find\(\(f\) => !formDone\(f\)\)/.test(bs) && /choose “Later, from my visit link”/.test(bs) && !/formsLaterOk/.test(bs), '"Do them now" needs them finished; "Later" goes on (a service due to book always needs them)');
  ok(/setFormsWhen\(me && formsRuleOf\(service\)\.due !== 'booking' \? 'later' : 'now'\)/.test(bs) && /setKnown\(null\); setFormsWhen\('now'\)/.test(bs) && !/\[known\]\)/.test(bs) && /setFormsWhen\(w\); setFlowNote\(null\);/.test(bs), 'a client this device knows starts at "Later"; "Not you?" and a fresh open start at "Do them now"; switching clears the note');
  const sf = (src('src/components/booking/StudioFlow.tsx') + src('src/components/booking/flow-css.ts'));
  ok(/aria-label="Before your visit"/.test(sf) && /Before your visit\{totalFormMin \?/.test(sf) && /'Read and sign' : wordingOnly\(form\) \? 'Read it' : 'A few questions'/.test(sf) && /Asked on your visit link after you book\./.test(sf), 'the list: each form with how long it takes, and documents asked on the visit link');
  ok(/role="radiogroup" aria-label="When to do them"/.test(sf) && /Do them now/.test(sf) && /Later, from my visit link/.test(sf) && /!allFormsDone/.test(sf) && /tabIndex=\{c\.formsWhen === k \? 0 : -1\}/.test(sf), 'now or later (one tab stop, arrow keys), hidden once everything’s done');
  ok(sf.indexOf('aria-label="Before your visit"') < sf.indexOf('aria-label="Anything we should know"'), 'the list comes right after their details');
  ok(/One thing left before your visit/.test(sf) && /stillWords\(outcome\.stillNeeded/.test(sf) && /Do it now/.test(sf) && /outcome\.visitUrl && !req && !pending && \(outcome\.stillNeeded/.test(sf), 'the confirmation says what’s left, with the visit link (not on a request)');
  ok(/behindForm/.test(sf) && /\{\.\.\.behindForm\}/.test(sf) && /formOpenRef\.current && e\.key === 'Escape'/.test(sf) && /\|\| opener\.current\)\?\.focus\?\.\(/.test(sf) && /querySelector<HTMLElement>\('\[data-form-runner\]'\)/.test(sf) && /!el\.closest\('\[inert\]'\)/.test(sf) && /el\.tabIndex >= 0/.test(sf) && /!d\.hasAttribute\('data-form-runner'\)/.test(sf) && /data-form-runner=""/.test(fr), 'the form keeps Tab inside itself over the sheet, closes on Escape or Back, and hands focus back');
  ok(/k !== '__seen'/.test(sf), 'opening a form isn’t "started"');
  ok(/const formOpen = runner !== null && currentStep === 'details' && !!\(c\.requiredForms \|\| \[\]\)\[runner\]/.test(sf) && /const behindForm: any = formOpen \?/.test(sf) && /if \(runner !== null && !formOpen\) setRunner\(null\)/.test(sf) && /if \(c\.flowNote\?\.about === 'forms'\) c\.setFlowNote\?\.\(null\)/.test(sf) && /data-form-row=\{i\}/.test(sf) && /about: 'forms' \}/.test(bs), 'the sheet is shut off only while a form is really showing; closing a form clears its note');
  ok(!/textTransform: 'uppercase'/.test(sf), 'no all-caps labels');

  // ── the server: only finished forms count, checked before the visit is written
  const book = src('src/app/api/appointments/book/route.ts');
  ok(/f\.guardian\.confirmed === true && typeof f\.guardian\.name === 'string'/.test(book) && /sentFormDone\(def, f, rules\)/.test(book) && book.indexOf('sentFormDone(def, f, rules)') < book.indexOf('const result = await db.runTransaction') && /stillNeeded: askedItems \|\| \[\]/.test(book), 'each form is checked by the same rule before the visit is written; the answer says what the visit link still asks for');
  ok(/acceptedForms\.length \? \{ signedForms: acceptedForms \}/.test(book) && /asideForms\.length \? \{ formsSetAside: asideForms \}/.test(book) && !/formsAwaitingGuardian/.test(book) && /const keptForms = acceptedForms;/.test(book), 'only finished forms count on the visit; the rest are kept beside it, in the same write');
  ok(/\/\^\[A-Za-z0-9_-\]\{1,80\}\$\/\.test\(k\) && !\/\^__\.\*__\$\/\.test\(k\) && !\['__signedName', '__read', '__seen'\]\.includes\(k\)/.test(book) && /acknowledged: true/.test(book) && /Shorten a long answer/.test(book), 'answer keys are plain question ids; “I’ve read this” is kept; a too-large send says what to do');
  ok(/signedName: f\.signedName\.trim\(\)\.slice\(0, 120\)/.test(book) && /formsCtx\.defsRead \? formsCtx\.defs\.map/.test(book) && /\[f\.id, f\.label\]\.some\(\(x\) => \/photo\.\?id\|\^id\$\/i\.test/.test(book), 'the signer’s name is kept; a form that couldn’t be read is still asked; photo ID by its id or label');
  const fsrv = src('src/lib/forms-server.ts');
  ok(/signedName\?: string \| null/.test(fsrv) && /signer \? \{ signedName: signer \}/.test(fsrv) && /guardianConfirmed: true/.test(fsrv) && /str\(def\?\.title \|\| f\.formTitle, 200\)/.test(fsrv), 'the copy on file keeps the signer’s name, the guardian’s consent, and the form’s own title');
  ok(/stillNeeded: h\.left \|\| \[\]/.test(src('src/lib/booking/engine-confirm.ts')) && /stillNeeded: h\.left \|\| \[\]/.test(src('src/app/(booking)/book/[tenantId]/page.tsx')), 'a held booking that turns out paid still says what’s left');
  ok(/f\?\.signedName \|\| '', f\?\.guardian \|\| null/.test(src('src/lib/booking/engine-confirm.ts')) && /stillNeeded: Array\.isArray\(out\.stillNeeded\)/.test(src('src/lib/booking/engine-confirm.ts')), 'a changed name or guardian books fresh; the client portal hears what’s still needed too');
  ok(/stillNeeded: Array\.isArray\(out\.stillNeeded\)/.test(src('src/app/(booking)/book/[tenantId]/page.tsx')) && /stillNeeded: x\.stillNeeded \|\| \[\]/.test(src('src/app/(booking)/portal/[tenantId]/page.tsx')) && /stillNeeded: x\.stillNeeded \|\| \[\]/.test(src('src/app/(booking)/portal/[tenantId]/[clientId]/page.tsx')), 'the booking page and both portal pages pass it to the confirmation');

  const all = [fr, bs, sf].join('\n');
  const tools = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  ok(!tools.test(all) && !/call us|contact us/i.test(all) && !/\{\/\*/.test(fr) && !/colour/i.test(fr), 'house rules: no tool names, no "call us", no JSX comments, US spelling');
  console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
