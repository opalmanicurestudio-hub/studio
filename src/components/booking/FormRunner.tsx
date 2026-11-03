'use client';
// src/components/booking/FormRunner.tsx — A FORM, ONE SCREEN AT A TIME (board FormsBook 3 and 4). Opened from the
// booking sheet's "Before your visit" list: the form's questions in the sheet's own look (one-choice answers as a row
// of choices, tick rows, roomy fields), its wording in a reading box with "Read all of it", then, just before the
// signature, the signer's full name, "I'm signing for someone under 18" and the guardian's name, how they're related
// and their consent, and the signature itself (drawn with a finger, or typed for anyone who can't draw one). A form
// with only wording asks "I've read this". The sheet holds the answers while it's open, so stepping out of a form and
// back keeps them. What's still missing stops the Next button, and it says how many things are left (lib/forms
// formLeft, the same rule the server checks). Photos asked for on a form go through the server (api/booking/photo),
// never the browser's own storage. A health form says the answers are kept private to the business.
import * as React from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { ChevronLeft, Lock, X } from 'lucide-react';
import { isHealthForm, fieldsOf, hasSignature, wordingOnly, formMinutes, guardianSigns, formLeft, TYPED, type Guardian } from '@/lib/forms';

export { fieldsOf, hasSignature, wordingOnly, formMinutes, guardianSigns, formLeft, TYPED };
export type { Guardian };

function Reading({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  const long = text.length > 320;
  return (
    <div>
      <div className="cf-grp relative px-4 py-3.5 text-[14.5px] leading-relaxed" style={{ maxHeight: open || !long ? 'none' : 150, overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
        {text}
        {long && !open && <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: 'linear-gradient(transparent, var(--card))' }} />}
      </div>
      {long && <button type="button" onClick={() => setOpen((v) => !v)} className="cf-link min-h-11 min-w-11 px-2" aria-expanded={open}>{open ? 'Show less' : 'Read all of it'}</button>}
    </div>
  );
}

// The pad is paper-white with dark ink in every look: the signature is kept as an image and read on white later. The
// canvas stays while they sign, so every stroke counts; a signature from before shows as a picture until they clear
// it. Anyone who can't draw one can type it instead, in the signer's name.
function Pad({ value, onChange, name }: { value: string | null; onChange: (v: string | null) => void; name: string }) {
  const ref = React.useRef<SignatureCanvas | null>(null);
  const [fresh, setFresh] = React.useState(false);
  const typed = typeof value === 'string' && value.startsWith(TYPED);
  const save = () => {
    const c: any = ref.current; if (!c || c.isEmpty?.()) return;
    let url: string | null = null;
    try { url = c.getTrimmedCanvas().toDataURL('image/png'); } catch { try { url = c.toDataURL('image/png'); } catch { url = null; } }
    onChange(url && url !== 'data:,' ? url : null);
  };
  const clear = () => { ref.current?.clear(); setFresh(true); onChange(null); };
  return (
    <div className="cf-grp px-3 pb-3 pt-1">
      <div className="flex min-h-11 items-center justify-between px-1 text-[13px]" style={{ color: 'var(--muted)' }}>
        <span>{typed ? 'Typed signature' : value ? 'Signed' : 'Sign with your finger'}</span>
        <button type="button" onClick={clear} className="cf-link min-h-11 min-w-11 px-2">Clear</button>
      </div>
      <div className="relative h-36 overflow-hidden rounded-xl" style={{ background: '#fff', color: '#16171a' }}>
        {typed
          ? <p className="grid h-full place-items-center px-4 text-center text-[26px] italic" style={{ fontFamily: 'Georgia, serif' }}>{value!.slice(TYPED.length)}</p>
          : value && !fresh
            ? <img src={value} alt="Your signature" className="h-full w-full object-contain" />
            : <SignatureCanvas ref={ref} penColor="#16171a" clearOnResize={false} canvasProps={{ className: 'h-full w-full', role: 'img', 'aria-label': 'Signature pad' } as any} onBegin={() => setFresh(true)} onEnd={save} />}
        <span aria-hidden className="pointer-events-none absolute inset-x-5 bottom-6 border-b border-dashed" style={{ borderColor: '#c9cacd' }} />
      </div>
      {!value && <button type="button" disabled={!name.trim()} onClick={() => onChange(`${TYPED}${name.trim()}`)} className="cf-link mt-1 min-h-11 min-w-11 px-1 disabled:opacity-40">
        {name.trim() ? 'Type it instead' : 'Type it instead (add the full name first)'}</button>}
    </div>
  );
}

async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(url); }
}

function PhotoQuestion({ tenantId, value, onChange }: { tenantId: string; value: string | null; onChange: (v: string | null) => void }) {
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const pick = async (f?: File | null) => {
    if (!f) return; setErr('');
    if (!/^image\//.test(f.type)) { setErr('Choose a photo (JPG or PNG).'); return; }
    if (f.size > 25 * 1024 * 1024) { setErr('That photo is too large. Choose one under 25 MB.'); return; }
    setBusy(true);
    try {
      const dataUrl = await shrink(f);
      const r = await fetch('/api/booking/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, dataUrl }) });
      const d = await r.json().catch(() => null);
      if (d?.ok && d.url) onChange(d.url); else setErr(d?.error || 'That photo didn’t upload. Try again.');
    } catch { setErr('That photo didn’t upload. Try again.'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      {value && <img src={value} alt="Your photo" className="max-h-56 w-full rounded-2xl object-cover" />}
      <label className="cf-quiet w-full cursor-pointer focus-within:ring-2 focus-within:ring-offset-2" style={{ ['--tw-ring-color' as any]: 'var(--accent)' }}>{busy ? 'Uploading…' : value ? 'Choose another photo' : 'Add a photo'}
        <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.currentTarget.value = ''; }} /></label>
      {err && <p className="cf-err px-1" role="alert">{err}</p>}
    </div>
  );
}

const Tick = ({ on }: { on: boolean }) => (
  <span aria-hidden className="grid h-6 w-6 flex-none place-items-center rounded-[7px]" style={on ? { background: 'var(--accent)', color: '#fff' } : { boxShadow: 'inset 0 0 0 2px var(--line)' }}>
    {on && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>}</span>);

/** One-choice answers: a row of choices that wrap, one tab stop, arrow keys to move between them. */
function Choices({ options, value, set, labelledBy }: { options: string[]; value: any; set: (v: string) => void; labelledBy: string }) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(0, options.indexOf(value));
  const move = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return; e.preventDefault();
    const j = (i + d + options.length) % options.length; set(options[j]); refs.current[j]?.focus();
  };
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">{options.map((o, i) => (
      <button key={o} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={value === o} tabIndex={i === at ? 0 : -1}
        onClick={() => set(o)} onKeyDown={(e) => move(e, i)} className="cf-chip cf-chip-text"
        style={{ height: 'auto', minHeight: 44, flex: '0 1 auto', maxWidth: '100%', whiteSpace: 'normal', paddingTop: 8, paddingBottom: 8, textAlign: 'left' }}>{o}</button>))}
    </div>);
}

function Field({ f, value, set, tenantId, signer }: { f: any; value: any; set: (v: any) => void; tenantId: string; signer: string }) {
  const id = React.useId();
  const label = <p id={id} className="text-[16px] font-semibold leading-snug">{f.label || 'Question'}{f.required === false && f.type !== 'signature' && <span className="font-normal" style={{ color: 'var(--muted)' }}> (optional)</span>}</p>;
  if (f.type === 'heading') return <h3 className="pt-1 text-[18px] font-semibold">{f.label}</h3>;
  if (f.type === 'paragraph') return <Reading text={String(f.label || '')} />;
  if (f.type === 'long-text') return <label className="block space-y-2">{label}<textarea value={value || ''} onChange={(e) => set(e.target.value)} rows={3} className="cf-field" style={{ height: 'auto', padding: '12px 14px' }} /></label>;
  if (f.type === 'multiple-choice') return <div className="space-y-2.5">{label}<Choices options={(f.options || []).map(String)} value={value} set={set} labelledBy={id} /></div>;
  if (f.type === 'checkboxes') { const on: string[] = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-2.5"><legend className="mb-2.5">{label}</legend>
        <div className="cf-grp">{(f.options || []).map((o: string) => { const sel = on.includes(o);
          return (<label key={o} className="cf-row cf-tap cursor-pointer">
            <input type="checkbox" className="sr-only" checked={sel} onChange={() => set(sel ? on.filter((x) => x !== o) : [...on, o])} />
            <Tick on={sel} /><span className="flex-1 text-[15.5px]">{o}</span></label>); })}</div>
      </fieldset>); }
  if (f.type === 'image-upload') return <div className="space-y-2.5">{label}<PhotoQuestion tenantId={tenantId} value={value || null} onChange={set} /></div>;
  if (f.type === 'signature') return <div className="space-y-2">{label}<Pad value={value || null} onChange={set} name={signer} /></div>;
  return <label className="block space-y-2">{label}<input value={value || ''} onChange={(e) => set(e.target.value)} className="cf-field" /></label>;
}

export function FormRunner({ forms, index, setIndex, answers, setAnswer, guardians, setGuardian, guardianAsk, tenantId, businessName, onClose, onFinish, backLabel }: {
  forms: any[]; index: number; setIndex: (i: number) => void;
  answers: Record<string, Record<string, any>>; setAnswer: (formId: string, fieldId: string, v: any) => void;
  guardians: Record<string, Guardian>; setGuardian: (formId: string, g: Guardian) => void; guardianAsk: boolean;
  tenantId: string; businessName: string; onClose: () => void;
  /** "Done" on the last form (otherwise it closes, like the close button). */
  onFinish?: () => void;
  /** What the back button on the first form says it goes back to (for screen readers). */
  backLabel?: string;
}) {
  const form = forms[index]; const a = answers[form?.id] || {};
  const g: Guardian = guardians[form?.id] || { on: !!form?.requiresGuardianSignature, name: '', relationship: '', consent: false };
  const top = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { top.current?.scrollTo?.({ top: 0 }); top.current?.focus?.({ preventScroll: true }); }, [index]);
  // Opened: a form that requires nothing still counts as done only once it's been looked at.
  React.useEffect(() => { if (form?.id && answers[form.id]?.__seen !== true) setAnswer(form.id, '__seen', true); }, [form?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!form) return null;
  const left = formLeft(form, a, g, guardianAsk);
  const next = forms[index + 1];
  const fields = fieldsOf(form);
  const firstSig = fields.findIndex((f) => f.type === 'signature');
  const forChild = guardianSigns(form, g, guardianAsk);
  const mins = formMinutes(form);
  // Whoever signs: the guardian when one completes the form, otherwise the person named. A typed signature is in their
  // name, so it's cleared whenever that name (or who signs) changes.
  const signer = forChild ? g.name : String(a.__signedName || '');
  const clearTyped = () => { for (const f of fields) if (f.type === 'signature' && typeof a[f.id] === 'string' && a[f.id].startsWith(TYPED)) setAnswer(form.id, f.id, null); };
  const guardianSet = (next: Guardian, signerChanges: boolean) => { if (signerChanges) clearTyped(); setGuardian(form.id, next); };
  const signerBlock = (
    <div className="space-y-3">
      {hasSignature(form) && <label className="cf-grp flex"><span className="cf-row w-full"><span className="cf-k">{forChild ? 'Their full name' : 'Full name'}</span><input value={a.__signedName || ''} onChange={(e) => { if (!forChild) clearTyped(); setAnswer(form.id, '__signedName', e.target.value); }} autoComplete={forChild ? 'off' : 'name'} className="cf-in" placeholder={forChild ? 'The person having the service' : 'As you’d sign it'} /></span></label>}
      {hasSignature(form) && guardianAsk && !form.requiresGuardianSignature && <button type="button" role="switch" aria-checked={g.on} onClick={() => guardianSet({ ...g, on: !g.on }, true)} className="cf-grp cf-row cf-tap w-full text-left">
        <span className="flex-1 text-[15px]">I’m signing for someone under 18</span><span className={`cf-sw ${g.on ? 'is-on' : ''}`} aria-hidden><span /></span></button>}
      {forChild && <>
        {form.requiresGuardianSignature && <p className="px-1 text-[13.5px]" style={{ color: 'var(--muted)' }}>A parent or guardian completes this form.</p>}
        <div className="cf-grp">
          <label className="cf-row"><span className="cf-k">Your name</span><input value={g.name} onChange={(e) => guardianSet({ ...g, on: true, name: e.target.value }, true)} autoComplete="name" className="cf-in" placeholder="Parent or guardian" /></label>
          <label className="cf-row"><span className="cf-k">Related as</span><input value={g.relationship} onChange={(e) => guardianSet({ ...g, on: true, relationship: e.target.value }, false)} className="cf-in" placeholder="Mother, father, guardian…" /></label>
        </div>
        <label className="cf-grp cf-row cf-tap cursor-pointer">
          <input type="checkbox" className="sr-only" checked={g.consent === true} onChange={() => guardianSet({ ...g, on: true, consent: g.consent !== true }, false)} />
          <Tick on={g.consent === true} /><span className="flex-1 py-3 text-[15px] leading-snug">I’m their parent or legal guardian, and I agree to this form for them.</span></label>
      </>}
    </div>);
  const showSigner = hasSignature(form) || forChild;
  return (
    <div data-form-runner="" className="absolute inset-0 z-20 flex flex-col" style={{ background: 'var(--paper)' }} role="dialog" aria-modal="true" aria-labelledby="fr-title" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="cf-bar">
        <button type="button" onClick={() => (index > 0 ? setIndex(index - 1) : onClose())} aria-label={index > 0 ? 'Back to the last form' : backLabel || 'Back to your details'} className="cf-round -ml-2"><span><ChevronLeft className="h-4 w-4" /></span></button>
        <p id="fr-title" className="min-w-0 flex-1 truncate text-[16px] font-semibold">{form.title || 'Form'}</p>
        <button type="button" onClick={onClose} aria-label="Close the form" className="cf-round"><span><X className="h-4 w-4" /></span></button>
      </div>
      <div key={form.id} ref={top} tabIndex={-1} role="group" aria-labelledby="fr-title" className="cf-body space-y-6 outline-none">
        <p className="text-[13px]" style={{ color: 'var(--muted)' }}>{forms.length > 1 ? `Form ${index + 1} of ${forms.length} · ` : ''}about {mins} minute{mins === 1 ? '' : 's'}</p>
        {fields.map((f, i) => (
          <React.Fragment key={`${form.id}:${f.id || i}`}>
            {i === firstSig && signerBlock}
            <Field f={f} value={a[f.id]} set={(v) => setAnswer(form.id, f.id, v)} tenantId={tenantId} signer={signer} />
          </React.Fragment>))}
        {firstSig < 0 && showSigner && signerBlock}
        {wordingOnly(form) && <label className="cf-grp cf-row cf-tap cursor-pointer">
          <input type="checkbox" className="sr-only" checked={a.__read === true} onChange={() => setAnswer(form.id, '__read', a.__read !== true)} />
          <Tick on={a.__read === true} /><span className="flex-1 text-[15.5px]">I’ve read this</span></label>}
        {isHealthForm(form) && <p className="flex items-start gap-2 px-1 text-[13px] leading-snug" style={{ color: 'var(--muted)' }}><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Your answers are kept private to {businessName || 'the business'}.</p>}
      </div>
      <div className="cf-foot">
        <p className="sr-only" aria-live="polite">{left > 0 ? `${left} ${left === 1 ? 'thing' : 'things'} left on this form` : 'This form is done'}</p>
        <button type="button" disabled={left > 0} onClick={() => (next ? setIndex(index + 1) : (onFinish || onClose)())} className="cf-btn">
          {left > 0 ? `${left} ${left === 1 ? 'thing' : 'things'} left` : next ? `Next: ${next.title || 'the next form'}` : 'Done'}
        </button>
      </div>
    </div>
  );
}
