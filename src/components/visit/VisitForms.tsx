'use client';
// src/components/visit/VisitForms.tsx — WHAT'S LEFT, ON THE VISIT LINK (board FormsAfter). A ring for how much is done,
// "One thing left" and when it's due, then each form the visit asks for: done (signed for this visit, or still current
// on file), to sign (with how long it takes), or "anything changed?" for health answers already on file. A form opens
// one at a time in the same form screen as the booking sheet (FormRunner), and each one is saved when they tap Done
// (api/checkin/actions "form"), so the list ticks off as they go; closing a form without Done saves nothing and keeps
// their answers while this list is open. Shown three ways: inside the visit's request screen (VisitGates), as a
// card on the visit link before the day, and on arrival ("One thing before Mia starts").
import * as React from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { FormRunner } from '@/components/booking/FormRunner';
import { FLOW_CSS } from '@/components/booking/flow-css';
import { PUBLIC_CSS, moodStyle } from '@/components/public/kit';
import { VisitShell, VisitButton, VisitSaid, type VisitBrand } from '@/components/booking/VisitShell';
import { visitDevice } from '@/components/visit/VerifyCard';
import { wallDate } from '@/lib/tenant-time';
import { hasSignature, FORM_META, type Guardian } from '@/lib/forms';

export type VisitAskView = { formId: string; title: string; ask: 'sign' | 'sign_again' | 'confirm' | 'done'; why: string; minutes: number; health: boolean; since?: string | null };
export type VisitFileView = { id: string; label: string; done: boolean; onFile: boolean; optional?: boolean };
export type VisitFormsView = { asks: VisitAskView[]; files: VisitFileView[]; left: number; dueAt: string | null; release?: 'off' | 'auto' | 'ask' };

const todo = (a: VisitAskView) => a.ask === 'sign' || a.ask === 'sign_again';
/** Things still to do, "anything changed?" included (it doesn't hold the visit up, but it's asked). Optional documents aren't. */
export const thingsLeft = (v: VisitFormsView | null | undefined) => !v ? 0 : v.asks.filter((a) => todo(a) || a.ask === 'confirm').length + v.files.filter((f) => !f.done && !f.optional).length;
const when = (iso: string, brand: VisitBrand, long = false) => { const d = wallDate(new Date(iso), brand.zone); return `${format(d, long ? 'EEEE' : 'EEE')} at ${format(d, 'h:mm a')}`; };
const day = (iso: string | null | undefined, brand: VisitBrand) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? format(wallDate(new Date(t), brand.zone), 'MMMM d') : ''; };

/** How much is done, as a ring. */
export function Ring({ done, total, size = 54 }: { done: number; total: number; size?: number }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r, f = total > 0 ? done / total : 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="flex-none">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={size > 40 ? 6 : 4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={f >= 1 ? 'var(--good)' : 'var(--accent)'} strokeWidth={size > 40 ? 6 : 4} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - f)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>);
}
const Tick = () => (
  <span aria-hidden className="grid h-7 w-7 flex-none place-items-center rounded-full" style={{ background: 'var(--good-soft)', color: 'var(--good)' }}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg></span>);
const Open = ({ soft }: { soft?: boolean }) => <span aria-hidden className="h-7 w-7 flex-none rounded-full" style={{ boxShadow: `inset 0 0 0 2px ${soft ? 'var(--line)' : 'var(--warn, #b45309)'}` }} />;

/** The form screen, over the visit link: the booking sheet's own look, everything behind it out of reach while it's
 *  open, and focus back where it was after (or on the list, when that spot has changed). */
function FormSheet({ brand, children, back }: { brand: VisitBrand; children: React.ReactNode; back: React.RefObject<HTMLElement | null> }) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = document.createElement('div'); document.body.appendChild(el); setHost(el);
    const behind = Array.from(document.body.children).filter((x) => x !== el && !x.hasAttribute('inert') && x.tagName !== 'SCRIPT') as HTMLElement[];
    behind.forEach((x) => x.setAttribute('inert', ''));
    const h = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden';
    return () => {
      behind.forEach((x) => x.removeAttribute('inert')); document.documentElement.style.overflow = h; el.remove();
      window.setTimeout(() => { try { (before && before !== document.body && before.isConnected && !(before as any).disabled ? before : back.current)?.focus?.({ preventScroll: true }); } catch { /* gone */ } }, 0);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!host) return null;
  return createPortal(
    <div className="pub" data-mood={brand.mood || 'soft'} style={moodStyle(brand.accent, brand.mood || 'soft') as any}>
      <style>{PUBLIC_CSS}{FLOW_CSS}</style>
      <div className="fixed inset-0 z-[90] mx-auto max-w-[560px]" style={{ background: 'var(--paper)' }}>{children}</div>
    </div>, host);
}

/** The list: ring and heading (unless the screen has its own), each form and document, "anything changed?", the next
 *  thing to do, and when it's due. Saves each form when it's finished; onChanged asks the page for the list again. */
export function FormsLeft({ brand, visit, forms, token, tenantId, guardianAsk, businessName, onChanged, onAllDone, onSaved, header = true, heading = 'h2', provider, moreAfter }: {
  brand: VisitBrand; visit: VisitFormsView; forms: any[]; token: string; tenantId: string; guardianAsk: boolean; businessName: string;
  onChanged: () => void; onAllDone?: () => void; onSaved?: (formId: string) => void; header?: boolean; heading?: 'h1' | 'h2'; provider?: string | null;
  /** The screen asks for more below (a deposit, a policy…): done here means "forms done", not "all done". */
  moreAfter?: boolean;
}) {
  const [answers, setAnswers] = React.useState<Record<string, Record<string, any>>>({});
  const [guardians, setGuardians] = React.useState<Record<string, Guardian>>({});
  const [open, setOpen] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState<string | null>(null);
  const top = React.useRef<HTMLDivElement>(null);
  // Saved just now: ticked straight away, before the page has the list again.
  const [savedNow, setSavedNow] = React.useState<Record<string, true>>({});
  const asks = visit.asks.map((a) => (savedNow[a.formId] && a.ask !== 'done' ? { ...a, ask: 'done' as const, why: 'Done just now' } : a));
  const files = visit.files;
  const total = asks.length + files.filter((f) => !f.optional || f.done).length;
  const done = asks.filter((a) => a.ask === 'done').length + files.filter((f) => f.done).length;
  const left = Math.max(0, total - done);
  const next = asks.find(todo);
  const defOf = (id: string) => forms.find((f: any) => f?.id === id) || null;
  const post = async (body: any) => {
    const r = await fetch('/api/checkin/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, token, device: visitDevice() }) });
    return r.json().catch(() => null);
  };

  const save = async (formId: string) => {
    const def = defOf(formId); if (!def) return;
    const a = answers[formId] || {}; const g = guardians[formId];
    setBusy(formId); setSaid(null);
    try {
      const d = await post({ action: 'form', formId, formData: Object.fromEntries(Object.entries(a).filter(([k]) => !FORM_META.has(k))),
        ...(String(a.__signedName || '').trim() ? { signedName: String(a.__signedName).trim() } : {}), ...(a.__read === true ? { acknowledged: true } : {}),
        ...(g?.consent === true && (g.on || def.requiresGuardianSignature) ? { guardian: { name: g.name.trim(), relationship: g.relationship.trim(), confirmed: true } } : {}) });
      if (!d?.ok) { setSaid(d?.error || 'That form didn’t save. Please try again.'); onChanged(); return; }
      setSavedNow((p) => ({ ...p, [formId]: true })); onSaved?.(formId);
      // Closed: on to "you're all set", unless "anything changed?" is still asked here.
      onChanged(); if (d.done && !asks.some((x) => x.ask === 'confirm' && x.formId !== formId && !savedNow[x.formId])) onAllDone?.();
    } catch { setSaid('That form didn’t save. Check your connection and try again.'); } finally { setBusy(null); }
  };
  const same = async (formId: string) => {
    setBusy(formId); setSaid(null);
    try {
      const d = await post({ action: 'health_same', formId });
      if (!d?.ok) { setSaid(d?.error || 'That didn’t save. Please try again.'); onChanged(); return; }
      setSavedNow((p) => ({ ...p, [formId]: true })); onChanged();
    } catch { setSaid('That didn’t save. Check your connection and try again.'); } finally { setBusy(null); }
  };
  const openDef = open ? defOf(open) : null;
  const due = visit.dueAt && Date.parse(visit.dueAt) > Date.now() ? visit.dueAt : null;
  const H = heading;

  return (
    <div ref={top} tabIndex={-1} className="space-y-4 outline-none">
      {header && <div className="flex items-center gap-3.5 px-1">
        <Ring done={done} total={total} />
        <div className="min-w-0">
          <H className="text-[26px] leading-tight" style={{ fontWeight: 300 }}>{left === 0 ? (moreAfter ? <>Forms <b>done</b></> : <>All <b>done</b></>) : left === 1 ? <>One thing <b>left</b></> : <>{left} things <b>left</b></>}</H>
          <p className="text-[14px]" style={{ color: 'var(--muted)' }}>{left === 0 ? (moreAfter ? 'Just the steps below now.' : 'Thank you. There’s nothing more to do.') : due ? `Due ${when(due, brand)}` : provider ? `Before ${provider} starts` : 'Before your visit'}</p>
        </div>
      </div>}

      {(asks.some((a) => a.ask !== 'confirm') || files.length > 0) && <div className="v-grp" aria-label="Before your visit">
        {asks.filter((a) => a.ask !== 'confirm').map((a) => {
          const def = defOf(a.formId); const can = !!def && todo(a);
          const sub = a.ask === 'done' ? a.why : !def ? 'Loading the form…' : a.ask === 'sign_again' ? `${a.why} · ${a.minutes} min` : `${hasSignature(def) ? 'Read and sign' : 'A few questions'} · ${a.minutes} min`;
          const inner = <>
            {a.ask === 'done' ? <Tick /> : <Open />}
            <span className="min-w-0 flex-1 py-2.5"><span className="block text-[15.5px]">{a.title}</span>
              <span className="block text-[13px]" style={{ color: a.ask === 'done' ? 'var(--muted)' : 'var(--warn)' }}>{busy === a.formId ? 'Saving…' : sub}</span></span>
            {can && <span className="text-[14px] font-semibold" style={{ color: 'var(--accent-text,var(--accent))' }}>{hasSignature(def) ? 'Sign' : 'Start'}</span>}
          </>;
          return can
            ? <button key={a.formId} type="button" disabled={!!busy} onClick={() => setOpen(a.formId)} className="v-row v-tap w-full text-left disabled:opacity-60" style={{ minHeight: 66 }}>{inner}</button>
            : <div key={a.formId} className="v-row" style={{ minHeight: 66 }}>{inner}</div>;
        })}
        {files.map((f) => (
          <div key={f.id} className="v-row" style={{ minHeight: 66 }}>
            {f.done ? <Tick /> : <Open soft={f.optional} />}
            <span className="min-w-0 flex-1 py-2.5"><span className="block text-[15.5px]">{f.label}</span>
              <span className="block text-[13px]" style={{ color: f.done || f.optional ? 'var(--muted)' : 'var(--warn)' }}>{f.done ? (f.onFile ? 'On file' : 'Added') : f.optional ? 'Optional · add it below' : 'Add it below'}</span></span>
          </div>))}
      </div>}

      {asks.filter((a) => a.ask === 'confirm').map((a) => (
        <section key={a.formId} className="pub-card space-y-3 p-4" aria-label={a.title}>
          <div><p className="text-[15.5px] font-semibold">{a.title}</p>
            <p className="mt-1 text-[14px] leading-snug" style={{ color: 'var(--muted)' }}>Anything changed{a.since ? ` since ${day(a.since, brand)}` : ''}, like new medications or allergies?</p></div>
          <div className="flex gap-2.5">
            <button type="button" onClick={() => void same(a.formId)} disabled={!!busy} className="v-btn flex-1" style={{ minHeight: 48, padding: '0 12px', fontSize: 15, whiteSpace: 'nowrap' }}>{busy === a.formId ? 'Saving…' : 'Nothing’s changed'}</button>
            <button type="button" onClick={() => setOpen(a.formId)} disabled={!defOf(a.formId) || !!busy} className="v-btn v-btn-quiet flex-1" style={{ minHeight: 48, padding: '0 12px', fontSize: 15 }}>Update</button>
          </div>
        </section>))}

      <VisitSaid text={said} />
      {next && defOf(next.formId) && <VisitButton onClick={() => setOpen(next.formId)} disabled={!!busy}>{`${hasSignature(defOf(next.formId)) ? 'Sign' : 'Start'}: ${next.title}`}</VisitButton>}
      {left > 0 && <p className="px-1 text-[13px] leading-snug" style={{ color: 'var(--muted)' }}>
        {!header ? `${provider || 'Your provider'} sees it the moment you’re done.` : due && visit.release === 'auto' && visit.asks.some(todo) ? `If your forms aren’t done by ${when(due, brand, true)}, your appointment time is released.`
          : due && visit.release === 'ask' && visit.asks.some(todo) ? `If your forms aren’t done by ${when(due, brand, true)}, your appointment time may be released.`
          : due ? `If it isn’t done by ${when(due, brand, true)}, we’ll go through it with you when you arrive.` : 'Anything not done is gone through with you when you arrive.'}</p>}

      {open && openDef && <FormSheet brand={brand} back={top}>
        <FormRunner forms={[openDef]} index={0} setIndex={() => {}} answers={answers}
          setAnswer={(fid, k, v) => setAnswers((p) => ({ ...p, [fid]: { ...(p[fid] || {}), [k]: v } }))}
          guardians={guardians} setGuardian={(fid, g) => setGuardians((p) => ({ ...p, [fid]: g }))} guardianAsk={guardianAsk}
          tenantId={tenantId} businessName={businessName} backLabel="Back to the list"
          onClose={() => setOpen(null)} onFinish={() => { const id = open; setOpen(null); if (id) void save(id); }} />
      </FormSheet>}
    </div>
  );
}

/** On the visit link before the day (or on it), when something is left and the request screen isn't showing: a card
 *  with the ring and the next thing, which opens the list. */
export function FormsLeftCard({ visit, onOpen }: { visit: VisitFormsView; onOpen: () => void }) {
  const n = thingsLeft(visit); if (!n) return null;
  const total = visit.asks.length + visit.files.filter((f) => !f.optional || f.done).length;
  const next = visit.asks.find(todo) || visit.asks.find((a) => a.ask === 'confirm');
  return (
    <button type="button" onClick={onOpen} className="pub-card pub-press flex w-full items-center gap-3 p-4 text-left">
      <Ring done={Math.max(0, total - n)} total={total} size={36} />
      <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{n === 1 ? 'One thing left before your visit' : `${n} things left before your visit`}</span>
        <span className="block text-[13px] leading-snug" style={{ color: 'var(--muted)' }}>{next ? (next.ask === 'confirm' ? `${next.title}: anything changed?` : `${next.title} · ${next.minutes} min`) : 'A document to add'}</span></span>
      <span className="text-[14px] font-semibold" style={{ color: 'var(--accent-text,var(--accent))' }}>Open</span>
    </button>);
}

/** The list on its own screen: from the card before the day ("Back to my visit"), or on arrival ("One thing before Mia
 *  starts", with "Not now"). */
export function FormsLeftView({ brand, visit, forms, token, tenantId, guardianAsk, businessName, onChanged, onBack, arriving, first, provider }: {
  brand: VisitBrand; visit: VisitFormsView; forms: any[]; token: string; tenantId: string; guardianAsk: boolean; businessName: string;
  onChanged: () => void; onBack: () => void; arriving?: boolean; first?: string | null; provider?: string | null;
}) {
  const n = thingsLeft(visit);
  const nextLeft = visit.asks.find(todo);
  const before = provider ? `${provider} starts` : 'your visit starts';
  return (
    <VisitShell brand={brand} chip={arriving ? 'Here' : null}
      kicker={arriving && first ? `Welcome in, ${first}` : undefined}
      title={arriving ? <>{n <= 1 ? 'One thing' : `${n} things`} <b>before {before}</b></> : undefined}
      subtitle={arriving && nextLeft ? `${nextLeft.title} isn’t finished yet. It takes about ${nextLeft.minutes} minute${nextLeft.minutes === 1 ? '' : 's'}.` : undefined}>
      <FormsLeft brand={brand} visit={visit} forms={forms} token={token} tenantId={tenantId} guardianAsk={guardianAsk} businessName={businessName} onChanged={onChanged} header={!arriving} heading="h1" provider={provider} />
      <VisitButton quiet onClick={onBack}>{arriving ? 'Not now' : 'Back to my visit'}</VisitButton>
    </VisitShell>);
}
