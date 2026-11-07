'use client';
// src/components/planner/BeforeVisit.tsx — WHAT A CLIENT HAS SENT BEFORE THEIR VISIT, FOR THE TEAM (board FormsStaff).
// On the appointment: "3 of 4 ready", then each form the visit asks for (done, with the answers one tap away; health
// answers only for people who may see health notes, and who opened them is logged; not signed, with when it's due,
// "Send a reminder" and "Waive, with a reason"), the documents the service asks for (on file or sent, each to view),
// and inspiration photos with their notes ("Looks good"). One rule for what's done (lib/forms). Nothing here charges or
// releases anything: it says what happens if a form isn't done, as the business's Automations have it.
import * as React from 'react';
import { format } from 'date-fns';
import { formAsks, formsAskedFor, formRulesOf, formsDueAt, formsRuleOf, waivedOnVisit, isHealthForm, toMs } from '@/lib/forms';
import { wallDate, tenantTimeZone } from '@/lib/tenant-time';
import { readinessRules } from '@/lib/readiness-rules';
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
  // Answers kept beside the visit (a long visit record moves older ones there): read when opened, by the same rule.
  // Each read is for one visit: one that comes back after the team has moved to another visit is dropped.
  const [moved, setMoved] = React.useState<Record<string, any | 'loading' | { error: string; again?: boolean }>>({});
  const [asking, setAsking] = React.useState(false); const [askNote, setAskNote] = React.useState(''); const [earlier, setEarlier] = React.useState(false);
  // A different visit starts clean.
  const noted = React.useRef(new Set<string>());   // an opening is noted once per form while this visit is open
  const logged = React.useRef(new Set<string>());  // and a health form's opening logged once
  const visitNow = React.useRef<string | null>(null); visitNow.current = appointment?.id ? String(appointment.id) : null;
  React.useEffect(() => { setOpen(null); setWaiving(null); setReason(''); setSaid(null); setMoved({}); setAsking(false); setAskNote(''); setEarlier(false); noted.current = new Set(); logged.current = new Set(); }, [appointment?.id]);
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
  const inspo = appointment?.inspoReview || null;
  // Asked over an hour ago and nothing yet: the team may ask again (the server allows once an hour).
  const askAgain = inspo?.status === 'again' && !!toMs(inspo?.at) && Date.now() - toMs(inspo.at) > 3600e3;
  const before: any[] = (Array.isArray(appointment?.inspirationPhotosEarlier) ? appointment.inspirationPhotosEarlier : []).filter((p: any) => p?.url);
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
  const own = formsRuleOf(services[0]);   // the visit's own service: when its forms are due, and what happens if they aren't done
  const dueMs = toMs(formsDueAt(appointment?.startTime, appointment?.createdAt, own.dueHours));
  const dueWall = dueMs ? wallDate(new Date(dueMs), zone) : null;
  const dueWords = dueWall ? `${format(dueWall, 'EEE')} at ${format(dueWall, 'h:mm a')}` : '';
  const first = String(appointment?.clientName || client?.name || 'The client').split(' ')[0];
  const todos = asks.filter((a) => a.ask === 'sign' || a.ask === 'sign_again');
  // What Automations does about an unsigned form: only the visit's own service forms count there.
  // (It acts only with a second window set; services[0] is the visit's own service, never an add-on.)
  const auto = tenant?.appointmentAutomations?.consentFormUnsigned;
  const mainForms: string[] = Array.isArray(services[0]?.requiredFormIds) ? services[0].requiredFormIds.map(String) : [];
  const hours = Number(auto?.secondWindowHours);
  const gated = !own.own && auto?.enabled && auto?.secondWindowHours != null && Number.isFinite(hours) ? todos.find((a) => mainForms.includes(a.formId)) : undefined;
  // A service with its own rule (Settings › Forms and documents) says so instead; the time is released only for its own
  // forms, and only when they were due well before the visit (lib/forms-release).
  // When that would happen: at the due time, or once they've had 12 hours since booking (lib/forms-release).
  const releaseMs = dueMs ? Math.max(dueMs, toMs(appointment?.createdAt) + 12 * 3600e3) : 0;
  const releaseWall = releaseMs ? wallDate(new Date(releaseMs), zone) : null;
  const releaseWords = releaseWall ? `${format(releaseWall, 'EEE')} at ${format(releaseWall, 'h:mm a')}` : '';
  const ownGated = own.own && own.release !== 'off' && releaseMs && releaseMs <= toMs(appointment?.startTime) - 2 * 3600e3 ? todos.find((a) => mainForms.includes(a.formId)) : undefined;
  const startWaits = readinessRules(tenant, services[0]).forms === 'block';
  // The visit's own copy, unless its answers were moved off the visit (then the copy on file has them).
  const entryFor = (formId: string) => {
    const here = (Array.isArray(appointment?.signedForms) ? appointment.signedForms : []).find((f: any) => f && typeof f === 'object' && f.formId === formId) || null;
    const kept = (signedConsents || []).find((x: any) => x?.formId === formId && !x.revokedAt) || null;
    return here?.answersMoved && kept && (!here.signedAt || toMs(kept.signedAt) >= toMs(here.signedAt)) ? kept : here || kept;
  };

  const post = async (body: any) => {
    const r = await fetch('/api/forms/visit', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify({ tenantId, apptId: appointment.id, ...body }) });
    return { status: r.status, d: await r.json().catch(() => null) };
  };
  const call = async (body: any) => (await post(body)).d;
  const act = async (key: string, body: any, ok: string) => {
    setBusy(key); setSaid(null);
    try { const d = await call(body); setSaid(d?.ok ? { text: ok, ok: true } : { text: d?.error || 'That didn’t go through. Please try again.' }); return !!d?.ok; }
    catch { setSaid({ text: 'That didn’t go through. Check your connection and try again.' }); return false; } finally { setBusy(null); }
  };
  // Answers kept beside the visit, read for this visit only. "Try again" for a slow moment; not for answers that are
  // private to this person or aren't there.
  const readMoved = (formId: string) => {
    const forVisit = visitNow.current; const failed = { error: 'Those answers couldn’t be opened just now.', again: true };
    setMoved((m) => ({ ...m, [formId]: 'loading' }));
    noted.current.add(formId);   // reading them notes the opening too
    post({ action: 'answers', formId })
      .then(({ status, d }) => { if (visitNow.current !== forVisit) return; setMoved((m) => ({ ...m, [formId]: d?.ok && d.record ? d.record : status === 403 || status === 404 ? { error: d?.error || 'Those answers can’t be opened here.' } : failed })); })
      .catch(() => { if (visitNow.current === forVisit) setMoved((m) => ({ ...m, [formId]: failed })); });
  };
  // Who opened health answers goes in the health-view log; any opening is noted for the visit.
  const see = (formId: string) => {
    const on = open === formId ? null : formId; setOpen(on); if (!on) return;
    const e = entryFor(formId);
    const def = forms.find((f) => f?.id === formId);
    if (isHealthForm(def) && client?.id && !logged.current.has(formId)) { logged.current.add(formId); logHealthOpen(tenant, { clientId: String(client.id), what: `Visit: ${def?.title || 'health answers'}`, appointmentId: String(appointment.id) }); }
    if (e?.answersMoved && !Object.keys(e.formData || {}).some((k) => !/^__/.test(k)) && (!moved[formId] || moved[formId]?.again)) readMoved(formId);
    if (noted.current.has(formId)) return;
    noted.current.add(formId);
    // Not noted (a slow moment): it's tried again the next time it's opened.
    call({ action: 'opened', formId }).then((d) => { if (!d?.ok) noted.current.delete(formId); }).catch(() => { noted.current.delete(formId); });
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
              {open === a.formId && def && entry && !locked && <div className="mt-3 rounded-2xl p-4 sm:ml-[38px]" style={{ background: SOFT }}>
                {moved[a.formId] === 'loading' ? <p className="text-[14px]" style={{ color: MUTED }}>Opening the answers…</p>
                  : moved[a.formId]?.error ? <div className="flex flex-wrap items-center gap-x-3"><p className="text-[14px]" role="alert" style={{ color: WARN }}>{moved[a.formId].error}</p>
                      {moved[a.formId].again && <button type="button" onClick={() => readMoved(a.formId)} className="min-h-11 px-1 text-[14px] font-semibold" style={{ color: INK }}>Try again</button>}</div>
                  : <SignedFormRecord record={moved[a.formId] && typeof moved[a.formId] === 'object' ? moved[a.formId] : entry} form={def} zone={zone} compact />}</div>}
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
              <p className="text-[13px]" style={{ color: MUTED }}>{photos.length} photo{photos.length === 1 ? '' : 's'}{photos.some((p) => p?.note) ? ' with notes' : ''} · {inspo?.status === 'ok' ? `looked at by ${String(inspo.by || 'the team').split(' ')[0]}` : inspo?.status === 'again' ? `${String(inspo.by || 'the team').split(' ')[0]} asked for different ones${inspo.note ? `: “${String(inspo.note).slice(0, 120)}”` : ''}` : inspo?.status === 'sent' ? 'new ones, waiting for you' : 'waiting for you'}</p></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2.5 pl-[38px]">
            {photos.slice(0, 7).map((p, k) => <button key={k} type="button" onClick={() => void openPrivateFile(p.url)} aria-label={`Open inspiration photo ${k + 1}`} className="rounded-[14px] focus:outline-none focus-visible:ring-2"><PrivateImg src={p.url} alt={p?.note || `Inspiration photo ${k + 1}`} className="h-[84px] w-[84px] rounded-[14px] object-cover" /></button>)}
            {photos.length > 7 && <button type="button" onClick={() => void openPrivateFile(photos[7].url)} className="grid h-[84px] w-[84px] place-items-center rounded-[14px] text-[15px] font-semibold" style={{ background: SOFT, color: INK }} aria-label={`${photos.length - 7} more photos`}>+{photos.length - 7}</button>}
          </div>
          {photos.filter((p) => p?.note).slice(0, 4).map((p, k) => <p key={k} className="mt-2 pl-[38px] text-[13.5px]" style={{ color: MUTED }}>“{String(p.note).slice(0, 300)}”</p>)}
          {before.length > 0 && <div className="mt-2 pl-[38px]">
            <button type="button" onClick={() => setEarlier((v) => !v)} aria-expanded={earlier} className="min-h-11 text-[14px] font-semibold" style={{ color: INK }}>{earlier ? 'Hide the earlier photos' : `See the earlier photos (${before.length})`}</button>
            {earlier && <div className="mt-1 flex flex-wrap gap-2.5">{before.slice(0, 12).map((p, k) => <button key={k} type="button" onClick={() => void openPrivateFile(p.url)} aria-label={`Open earlier photo ${k + 1}`} className="rounded-[14px] focus:outline-none focus-visible:ring-2"><PrivateImg src={p.url} alt={p?.note || `Earlier photo ${k + 1}`} className="h-[64px] w-[64px] rounded-[14px] object-cover opacity-80" /></button>)}</div>}
          </div>}
          {(inspo?.status !== 'ok' && inspo?.status !== 'again' || askAgain) && (asking
            ? <div className="mt-3 space-y-2 pl-[38px]">
                <label className="block"><span className="text-[13px]" style={{ color: MUTED }}>What would help? {first} sees this.</span>
                  <input value={askNote} onChange={(e) => setAskNote(e.target.value)} maxLength={200} className="mt-1 h-11 w-full rounded-xl px-3 text-[15px] outline-none focus:ring-2" style={{ boxShadow: `inset 0 0 0 1px ${LINE}` }} placeholder="A closer photo of the shape you like" /></label>
                <div className="flex gap-2"><Pill ink disabled={busy === 'again'} onClick={async () => { if (await act('again', { action: 'photos_again', note: askNote.trim() }, `Asked. ${first} can add new photos from their visit link.`)) { setAsking(false); setAskNote(''); } }}>{busy === 'again' ? 'Sending…' : 'Ask them'}</Pill><Pill onClick={() => { setAsking(false); setAskNote(''); setSaid(null); }}>Cancel</Pill></div>
              </div>
            : askAgain ? <div className="mt-3 flex flex-wrap gap-2 pl-[38px]"><Pill onClick={() => { setAsking(true); setAskNote(String(inspo?.note || '')); setSaid(null); }}>Ask again</Pill></div>
            : <div className="mt-3 flex flex-wrap gap-2 pl-[38px]"><Pill ink disabled={busy === 'photos'} onClick={() => void act('photos', { action: 'photos_ok' }, 'Marked as looked at.')}>Looks good</Pill><Pill onClick={() => { setAsking(true); setSaid(null); }}>Ask for different photos</Pill></div>)}
        </div>}
      </div>
      {said && <p role={said.ok ? 'status' : 'alert'} className="px-1 text-[13.5px]" style={{ color: said.ok ? GOOD : WARN }}>{said.text}</p>}
      {todos.length > 0 && <p className="px-1 text-[13.5px] leading-relaxed" style={{ color: MUTED }}>
        {ownGated && own.release === 'auto'
          ? `If “${ownGated.title}” isn’t signed by ${releaseWords}, the time is released and ${first} is told. Nothing is charged.`
          : ownGated && own.release === 'ask'
            ? `If “${ownGated.title}” isn’t signed by ${releaseWords}, you’re asked whether to release the time. Nothing is released without you.`
          : own.own
            ? `If “${todos[0].title}” isn’t signed${dueWords ? ` by ${dueWords}` : ''}, ${startWaits ? `${first} is asked first thing when they check in, and the visit starts once it’s signed.` : 'it shows here as a reminder. Nothing is held up.'}`
          : gated && auto?.severity === 'auto_cancel'
          ? `If “${gated.title}” isn’t signed ${hours > 0 ? `${hours} hour${hours === 1 ? '' : 's'} before the visit` : 'by the time the visit starts'}, the booking is canceled automatically (Automations).`
          : gated && auto?.severity === 'require'
            ? `If “${gated.title}” isn’t signed ${hours > 0 ? `${hours} hour${hours === 1 ? '' : 's'} before the visit` : 'by the time the visit starts'}, check-in waits until it’s signed (Automations).`
            : `If “${todos[0].title}” isn’t signed${dueWords ? ` by ${dueWords}` : ''}, ${first} is asked first thing when they check in. Nothing here is charged or released without you.`}</p>}
    </section>);
}
