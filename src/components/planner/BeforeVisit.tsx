'use client';
// src/components/planner/BeforeVisit.tsx — WHAT A CLIENT HAS SENT BEFORE THEIR VISIT, FOR THE TEAM (board FormsStaff).
// On the appointment: "3 of 4 ready", then each form the visit asks for (done, with the answers one tap away; health
// answers only for people who may see health notes, and who opened them is logged; not signed, with when it's due,
// "Send a reminder" and "Waive, with a reason"), the documents the service asks for (on file or sent, each to view),
// and inspiration photos with their notes ("Looks good"). One rule for what's done (lib/forms). Nothing here charges or
// releases anything: it says what happens if a form isn't done, as the business's Automations have it.
import * as React from 'react';
import { format } from 'date-fns';
import { formAsks, formsAskedFor, formRulesOf, formsDueAt, waivedOnVisit, isHealthForm, toMs } from '@/lib/forms';
import { wallDate, tenantTimeZone } from '@/lib/tenant-time';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { logHealthOpen } from '@/lib/health-view-client';
import { PrivateImg, openPrivateFile } from '@/components/shared/private-file';
import { SignedFormRecord } from '@/components/consents/SignedFormRecord';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', SOFT = '#f5f5f7', GOOD = '#1f7a4d', WARN = '#b45309';
const Tick = () => (
  <span aria-hidden className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full" style={{ background: '#eaf6ef' }}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={GOOD} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg></span>);
const Ring = () => <span aria-hidden className="h-[26px] w-[26px] flex-none rounded-full" style={{ boxShadow: `inset 0 0 0 2px ${WARN}` }} />;
const Pill = ({ children, onClick, ink, disabled }: { children: React.ReactNode; onClick?: () => void; ink?: boolean; disabled?: boolean }) => (
  <button type="button" onClick={onClick} disabled={disabled} className="inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-medium disabled:opacity-50"
    style={ink ? { background: INK, color: '#fff', fontWeight: 600 } : { background: SOFT, color: INK }}>{children}</button>);

export function BeforeVisit({ tenantId, tenant, appointment, client, services, forms, signedConsents, canSeeHealth = false, formsLoading }: {
  tenantId: string; tenant: any; appointment: any; client: any; services: any[]; forms: any[]; signedConsents?: any[] | null;
  /** May this person read health answers (Settings › privacy: care notes)? */
  canSeeHealth?: boolean;
  /** The business's forms are still loading (without it, no forms at all is taken as still loading). */
  formsLoading?: boolean;
}) {
  const [open, setOpen] = React.useState<string | null>(null);
  const [waiving, setWaiving] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState<{ text: string; ok?: boolean } | null>(null);
  // A different visit starts clean.
  const noted = React.useRef(new Set<string>());   // an opening is noted once per form while this visit is open
  React.useEffect(() => { setOpen(null); setWaiving(null); setReason(''); setSaid(null); noted.current = new Set(); }, [appointment?.id]);
  const zone = tenantTimeZone(tenant);
  const svcs = services.filter(Boolean);
  const asked = formsAskedFor(appointment, svcs);
  const ids = asked.filter((id) => forms.some((f) => f?.id === id));
  const asks = formAsks({ apt: appointment, ids, client: client || {}, forms, rules: formRulesOf(tenant) });
  const waived = waivedOnVisit(appointment);
  // Documents the service asks for: on the client's profile, or sent for this visit.
  const prof: any[] = Array.isArray(client?.profileDocuments) ? client.profileDocuments : [];
  const sent: any[] = Array.isArray(appointment?.requirementFiles) ? appointment.requirementFiles : [];
  const docs = svcs.flatMap((s: any) => (Array.isArray(s?.requiredFileRequirements) ? s.requiredFileRequirements : []))
    .filter((r: any, i: number, all: any[]) => r?.id && all.findIndex((x: any) => x?.id === r.id) === i)
    .map((r: any) => {
      const here = sent.find((x) => x?.requirementId === r.id && (x.files || []).length); const kept = prof.find((d) => d?.requirementId === r.id && (d.files || []).length);
      const files = ((here || kept)?.files || []).filter((f: any) => f?.url);
      return { id: String(r.id), label: String(r.label || r.prompt || 'A document'), files, kept: !here && !!kept, since: here ? 0 : toMs(kept?.uploadedAt), optional: r.required === false, done: !!(here || kept) };
    });
  const photos: any[] = (Array.isArray(appointment?.inspirationPhotos) && appointment.inspirationPhotos.length ? appointment.inspirationPhotos : appointment?.inspirationPhotoUrl ? [{ url: appointment.inspirationPhotoUrl }] : []).filter((p: any) => p?.url);
  // The forms haven't loaded yet: say so, rather than showing nothing to sign.
  if (asked.length && (formsLoading ?? !forms.length)) return (
    <section aria-label="Before the visit" aria-busy="true" className="space-y-3">
      <h3 className="text-[17px] font-semibold" style={{ color: INK }}>Before the visit</h3>
      <p className="rounded-[18px] px-4 py-4 text-[14px]" style={{ boxShadow: `0 0 0 1px ${LINE}`, color: MUTED }}>Loading this visit’s forms…</p>
    </section>);
  const total = asks.length + docs.filter((d) => !d.optional).length;
  const ready = asks.filter((a) => a.ask === 'done' || a.ask === 'confirm').length + docs.filter((d) => d.done && !d.optional).length;
  if (!total && !photos.length) return null;
  const dueMs = toMs(formsDueAt(appointment?.startTime, appointment?.createdAt));
  const dueWall = dueMs ? wallDate(new Date(dueMs), zone) : null;
  const dueWords = dueWall ? `${format(dueWall, 'EEE')} at ${format(dueWall, 'h:mm a')}` : '';
  const first = String(appointment?.clientName || client?.name || 'The client').split(' ')[0];
  const todos = asks.filter((a) => a.ask === 'sign' || a.ask === 'sign_again');
  // What Automations does about an unsigned form: only the visit's own service forms count there.
  // (It acts only with a second window set; services[0] is the visit's own service, never an add-on.)
  const auto = tenant?.appointmentAutomations?.consentFormUnsigned;
  const mainForms: string[] = Array.isArray(services[0]?.requiredFormIds) ? services[0].requiredFormIds.map(String) : [];
  const hours = Number(auto?.secondWindowHours);
  const gated = auto?.enabled && auto?.secondWindowHours != null && Number.isFinite(hours) ? todos.find((a) => mainForms.includes(a.formId)) : undefined;
  // The visit's own copy, unless its answers were moved off the visit (then the copy on file has them).
  const entryFor = (formId: string) => {
    const here = (Array.isArray(appointment?.signedForms) ? appointment.signedForms : []).find((f: any) => f && typeof f === 'object' && f.formId === formId) || null;
    const kept = (signedConsents || []).find((x: any) => x?.formId === formId && !x.revokedAt) || null;
    return here?.answersMoved && kept && (!here.signedAt || toMs(kept.signedAt) >= toMs(here.signedAt)) ? kept : here || kept;
  };

  const call = async (body: any) => {
    const r = await fetch('/api/forms/visit', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, apptId: appointment.id, ...body }) });
    return r.json().catch(() => null);
  };
  const act = async (key: string, body: any, ok: string) => {
    setBusy(key); setSaid(null);
    try { const d = await call(body); setSaid(d?.ok ? { text: ok, ok: true } : { text: d?.error || 'That didn’t go through. Please try again.' }); return !!d?.ok; }
    catch { setSaid({ text: 'That didn’t go through. Check your connection and try again.' }); return false; } finally { setBusy(null); }
  };
  // Who opened health answers goes in the health-view log; any opening is noted for the visit.
  const see = (formId: string) => {
    const on = open === formId ? null : formId; setOpen(on); if (!on || noted.current.has(formId)) return;
    noted.current.add(formId);
    // Not noted (a slow moment): it's tried again the next time it's opened.
    call({ action: 'opened', formId }).then((d) => { if (!d?.ok) noted.current.delete(formId); }).catch(() => { noted.current.delete(formId); });
    const def = forms.find((f) => f?.id === formId);
    if (isHealthForm(def) && client?.id) logHealthOpen(tenant, { clientId: String(client.id), what: `Visit: ${def?.title || 'health answers'}`, appointmentId: String(appointment.id) });
  };

  return (
    <section aria-label="Before the visit" className="space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="flex-1 text-[17px] font-semibold" style={{ color: INK }}>Before the visit</h3>
        {total > 0 && <span className="inline-flex h-[26px] items-center rounded-full px-2.5 text-[12.5px] font-semibold" style={ready >= total ? { background: '#eaf6ef', color: GOOD } : { background: '#fff7ed', color: WARN }}>{ready >= total ? 'All ready' : `${ready} of ${total} ready`}</span>}
      </div>
      <div className="overflow-hidden rounded-[18px]" style={{ boxShadow: `0 0 0 1px ${LINE}`, background: '#fff' }}>
        {asks.map((a, i) => {
          const def = forms.find((f) => f?.id === a.formId); const entry = entryFor(a.formId); const isWaived = waived.has(a.formId) && a.ask === 'done' && !!a.waived;
          const todo = a.ask === 'sign' || a.ask === 'sign_again';
          const locked = isHealthForm(def) && !canSeeHealth;
          return (
            <div key={a.formId} className="px-4 py-3.5" style={i ? { borderTop: `1px solid ${LINE}` } : undefined}>
              <div className="flex items-center gap-3">
                {todo ? <Ring /> : <Tick />}
                <div className="min-w-0 flex-1">
                  <p className="text-[15.5px]" style={{ color: INK }}>{a.title}</p>
                  <p className="text-[13px]" style={{ color: todo ? WARN : MUTED }}>{todo ? `${a.ask === 'sign_again' ? a.why : 'Not signed'}${dueWords ? ` · due ${dueWords}` : ''}` : a.ask === 'confirm' ? `${a.why} · asked if anything changed` : `${a.why}${entry && locked ? ' · health answers are private' : ''}`}</p>
                </div>
                {!todo && !isWaived && entry && def && !locked && <button type="button" onClick={() => see(a.formId)} aria-expanded={open === a.formId} className="min-h-11 min-w-11 px-1 text-[14px] font-semibold" style={{ color: INK }}>{open === a.formId ? 'Hide answers' : 'See answers'}</button>}
                {isWaived && <button type="button" disabled={busy === `u${a.formId}`} onClick={() => void act(`u${a.formId}`, { action: 'unwaive', formId: a.formId }, 'It’s asked for again.')} className="min-h-11 min-w-11 px-1 text-[14px] font-semibold disabled:opacity-50" style={{ color: INK }}>Undo</button>}
              </div>
              {open === a.formId && def && entry && !locked && <div className="mt-3 rounded-2xl p-4 sm:ml-[38px]" style={{ background: SOFT }}><SignedFormRecord record={entry} form={def} zone={zone} compact /></div>}
              {todo && (waiving === a.formId
                ? <div className="mt-3 space-y-2 pl-[38px]">
                    <label className="block"><span className="text-[13px]" style={{ color: MUTED }}>Why it isn’t needed this time (only the team sees this)</span>
                      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="mt-1 h-11 w-full rounded-xl px-3 text-[15px] outline-none focus:ring-2" style={{ boxShadow: `inset 0 0 0 1px ${LINE}` }} placeholder="Signed on paper at the desk" /></label>
                    <div className="flex gap-2"><Pill ink disabled={!reason.trim() || busy === `w${a.formId}`} onClick={async () => { if (await act(`w${a.formId}`, { action: 'waive', formId: a.formId, reason }, 'Waived for this visit.')) { setWaiving(null); setReason(''); } }}>Waive it</Pill><Pill onClick={() => { setWaiving(null); setReason(''); setSaid(null); }}>Keep asking</Pill></div>
                  </div>
                : <div className="mt-3 flex flex-wrap gap-2 pl-[38px]">
                    <Pill disabled={busy === 'remind'} onClick={() => void act('remind', { action: 'remind' }, `Reminder sent to ${first}.`)}>{busy === 'remind' ? 'Sending…' : 'Send a reminder'}</Pill>
                    <Pill onClick={() => { setWaiving(a.formId); setReason(''); setSaid(null); }}>Waive, with a reason</Pill>
                  </div>)}
            </div>);
        })}
        {docs.map((d, i) => (
          <div key={d.id} className="flex items-center gap-3 px-4 py-3.5" style={asks.length || i ? { borderTop: `1px solid ${LINE}` } : undefined}>
            {d.done ? <Tick /> : <Ring />}
            <div className="min-w-0 flex-1"><p className="text-[15.5px]" style={{ color: INK }}>{d.label}</p>
              <p className="text-[13px]" style={{ color: d.done || d.optional ? MUTED : WARN }}>{d.done ? (d.kept ? (d.since ? `On file since ${format(wallDate(new Date(d.since), zone), 'MMM d')}` : 'On file') : 'Sent for this visit') : d.optional ? 'Optional · not sent' : 'Not sent yet'}</p></div>
            {d.done && d.files.length > 0 && <div className="flex flex-wrap justify-end gap-x-3">{d.files.slice(0, 4).map((f: any, k: number) => <button key={k} type="button" onClick={() => void openPrivateFile(f.url)} className="min-h-11 min-w-11 px-1 text-[14px] font-semibold" style={{ color: INK }} aria-label={d.files.length > 1 ? `View ${d.label}, file ${k + 1}` : `View ${d.label}`}>{d.files.length > 1 ? `View ${k + 1}` : 'View'}</button>)}</div>}
          </div>))}
        {photos.length > 0 && <div className="px-4 py-3.5" style={asks.length || docs.length ? { borderTop: `1px solid ${LINE}` } : undefined}>
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full text-[12px] font-bold" style={{ background: INK, color: '#fff' }}>{photos.length}</span>
            <div className="min-w-0 flex-1"><p className="text-[15.5px]" style={{ color: INK }}>Inspiration photos</p>
              <p className="text-[13px]" style={{ color: MUTED }}>{photos.length} photo{photos.length === 1 ? '' : 's'}{photos.some((p) => p?.note) ? ' with notes' : ''} · {appointment?.inspoReview?.status === 'ok' ? `looked at by ${String(appointment.inspoReview.by || 'the team').split(' ')[0]}` : 'waiting for you'}</p></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2.5 pl-[38px]">
            {photos.slice(0, 7).map((p, k) => <button key={k} type="button" onClick={() => void openPrivateFile(p.url)} aria-label={`Open inspiration photo ${k + 1}`} className="rounded-[14px] focus:outline-none focus-visible:ring-2"><PrivateImg src={p.url} alt={p?.note || `Inspiration photo ${k + 1}`} className="h-[84px] w-[84px] rounded-[14px] object-cover" /></button>)}
            {photos.length > 7 && <button type="button" onClick={() => void openPrivateFile(photos[7].url)} className="grid h-[84px] w-[84px] place-items-center rounded-[14px] text-[15px] font-semibold" style={{ background: SOFT, color: INK }} aria-label={`${photos.length - 7} more photos`}>+{photos.length - 7}</button>}
          </div>
          {photos.filter((p) => p?.note).slice(0, 4).map((p, k) => <p key={k} className="mt-2 pl-[38px] text-[13.5px]" style={{ color: MUTED }}>“{String(p.note).slice(0, 300)}”</p>)}
          {appointment?.inspoReview?.status !== 'ok' && <div className="mt-3 pl-[38px]"><Pill ink disabled={busy === 'photos'} onClick={() => void act('photos', { action: 'photos_ok' }, 'Marked as looked at.')}>Looks good</Pill></div>}
        </div>}
      </div>
      {said && <p role={said.ok ? 'status' : 'alert'} className="px-1 text-[13.5px]" style={{ color: said.ok ? GOOD : WARN }}>{said.text}</p>}
      {todos.length > 0 && <p className="px-1 text-[13.5px] leading-relaxed" style={{ color: MUTED }}>
        {gated && auto?.severity === 'auto_cancel'
          ? `If “${gated.title}” isn’t signed ${hours > 0 ? `${hours} hour${hours === 1 ? '' : 's'} before the visit` : 'by the time the visit starts'}, the booking is canceled automatically (Automations).`
          : gated && auto?.severity === 'require'
            ? `If “${gated.title}” isn’t signed ${hours > 0 ? `${hours} hour${hours === 1 ? '' : 's'} before the visit` : 'by the time the visit starts'}, check-in waits until it’s signed (Automations).`
            : `If “${todos[0].title}” isn’t signed${dueWords ? ` by ${dueWords}` : ''}, ${first} is asked first thing when they check in. Nothing here is charged or released without you.`}</p>}
    </section>);
}
