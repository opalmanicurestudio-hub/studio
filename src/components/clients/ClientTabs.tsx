'use client';
import { useTenantOptional } from '@/context/TenantContext';
import { formsAskedFor, formStateOf, signedOnVisit, waivedOnVisit, formRulesOf } from '@/lib/forms';
// src/components/clients/ClientTabs.tsx — THE CLIENT PROFILE'S RECORDS, IN ONE STYLE.
//   useClientMessages — the client's messages (sent with delivery state, and texts that came in), from the server
//   ClientTimeline    — "Everything, in order": visits, payments, messages and forms in one stream, with filters
//   ClientMessages    — the conversation record: texts, emails, calls (recording and transcript), notes and decisions,
//                       with filters, export and print, and a box to send a text or email
//   ClientFormsNeeded — what must be signed before their upcoming visits, and what's on file
//   ClientPhotos      — every photo of the client, by visit, each with its record (ClientPhotoRecord)
import * as React from 'react';
import { format } from 'date-fns';
import { clientPhotos, filterCounts, FILTERS as PHOTO_FILTERS, KIND_LABEL as PHOTO_LABEL, type ClientPhoto } from '@/lib/client-photos';
import { ClientPhotoRecord } from '@/components/clients/ClientPhotoRecord';
import { usePrivateUrl } from '@/components/shared/private-file';
import { wallDate, tenantTimeZone } from '@/lib/tenant-time';

const safe = (v: any) => new Date(v?.toDate ? v.toDate() : v);
const muted = { color: 'hsl(var(--muted-foreground))' } as React.CSSProperties;
const card = { background: 'hsl(var(--card))', border: '1px solid var(--line, hsl(var(--border)))' } as React.CSSProperties;
const pill = (label: string, tone: 'ok' | 'warn' | 'soft' = 'soft') => <span className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={tone === 'ok' ? { background: 'color-mix(in srgb, var(--ok, #15803d) 12%, transparent)', color: 'var(--ok, #15803d)' } : tone === 'warn' ? { background: 'color-mix(in srgb, var(--warn, #b45309) 12%, transparent)', color: 'var(--warn, #b45309)' } : { background: 'hsl(var(--secondary))' }}>{label}</span>;
async function call(body: any) { const { getAuth } = await import('firebase/auth'); const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/clients/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => null); }

export function useClientMessages(tenantId: string | null | undefined, clientId: string) {
  const [state, setState] = React.useState<{ rows: any[] | null; canText: boolean; canEmail: boolean; error: string | null }>({ rows: null, canText: false, canEmail: false, error: null });
  const load = React.useCallback(async () => { if (!tenantId) return; const r: any = await call({ tenantId, clientId, action: 'list' }); setState(r?.ok ? { rows: r.rows, canText: r.canText, canEmail: r.canEmail, error: null } : { rows: [], canText: false, canEmail: false, error: r?.error || 'Couldn’t load messages.' }); }, [tenantId, clientId]);
  React.useEffect(() => { void load(); }, [load]);
  return { ...state, reload: load };
}

const statusPill = (st: string) => st === 'delivered' || st === 'received' ? pill(st === 'received' ? 'Received' : 'Delivered', 'ok') : /fail|bounce|undeliver/.test(st) ? pill(st === 'bounced' ? 'Bounced' : 'Didn’t arrive', 'warn') : /skip/.test(st) ? pill('Not sent') : pill('Sent');

type Ev = { at: Date; kind: 'visit' | 'payment' | 'message' | 'form'; title: React.ReactNode; detail?: React.ReactNode; tone?: 'warn' | 'ok'; onOpen?: () => void };
export function ClientTimeline({ appointments, services, staff, transactions, consents, messages, showMoney, onOpenVisit }: {
  appointments: any[]; services: any[]; staff: any[]; transactions: any[]; consents: any[]; messages: any[] | null; showMoney: boolean; onOpenVisit: (a: any) => void;
}) {
  const [filter, setFilter] = React.useState<'all' | Ev['kind']>('all'); const [limit, setLimit] = React.useState(12);
  const events = React.useMemo(() => { const out: Ev[] = []; const now = new Date();
    for (const a of appointments) { if (safe(a.startTime) > now) continue; const svc = services.find((s) => s.id === a.serviceId); const who = staff.find((s) => s.id === a.staffId);
      const cancelled = ['cancelled', 'declined', 'no_show'].includes(String(a.status));
      out.push({ at: safe(a.startTime), kind: 'visit', tone: cancelled ? 'warn' : undefined, onOpen: () => onOpenVisit(a), title: <><b>{svc?.name || a.serviceName || 'Visit'}</b>{who ? ` · ${who.name.split(' ')[0]}` : ''}</>,
        detail: cancelled ? (a.status === 'no_show' ? 'Didn’t come' : 'Cancelled') : [a.checkoutState?.formula?.length ? `formula: ${a.checkoutState.formula.slice(0, 2).map((x: any) => x.name).join(', ')}` : null, a.afterPhotos?.length ? `${a.afterPhotos.length} photo${a.afterPhotos.length === 1 ? '' : 's'}` : null, a.status === 'completed' ? null : String(a.status || '').replace(/_/g, ' ')].filter(Boolean).join(' · ') || undefined }); }
    if (showMoney) for (const t of transactions) { if (!t?.date) continue; const amt = Number(t.amount) || 0; out.push({ at: safe(t.date), kind: 'payment', tone: t.type === 'reversal' ? 'warn' : undefined, title: <><b>{t.type === 'reversal' ? 'Refund' : 'Payment'}</b> · ${Math.abs(amt).toFixed(2)}</>, detail: [t.description, t.paymentMethod].filter(Boolean).join(' · ') || undefined }); }
    for (const c of consents) { const at = c.signedAt || c.createdAt || c.at; if (!at) continue; out.push({ at: safe(at), kind: 'form', title: <><b>{c.formName || c.title || 'Form'}</b> signed</>, detail: [c.signedByName || c.signerName ? `by ${c.signedByName || c.signerName}` : null, c.version ? `v${c.version}` : null].filter(Boolean).join(' · ') || undefined }); }
    for (const m of (messages || []).filter((x: any) => !x.type || ['text', 'email', 'call'].includes(x.type))) out.push({ at: safe(m.at), kind: 'message', tone: /fail|bounce/.test(m.status) ? 'warn' : undefined, title: <>{m.type === 'call' ? `Call${m.dir === 'out' ? '' : ' from them'}` : m.dir === 'in' ? `${m.channel === 'email' ? 'Email' : 'Text'} from them` : `${m.channel === 'sms' ? 'Text' : 'Email'}${m.kind && m.kind !== 'staff_message' ? ` · ${String(m.kind).replace(/_/g, ' ')}` : ''}`}</>, detail: m.text ? `“${String(m.text).slice(0, 90)}${String(m.text).length > 90 ? '…' : ''}”` : m.subject || undefined });
    return out.filter((e) => !isNaN(e.at.getTime())).sort((x, y) => y.at.getTime() - x.at.getTime()); }, [appointments, services, staff, transactions, consents, messages, showMoney, onOpenVisit]);
  const shown = events.filter((e) => filter === 'all' || e.kind === filter);
  const dot = (e: Ev) => e.tone === 'warn' ? 'var(--warn, #b45309)' : e.kind === 'visit' ? 'var(--accent, #2e6f6a)' : e.kind === 'payment' ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))';
  const chips: [typeof filter, string][] = [['all', 'Everything'], ['visit', 'Visits'], ...(showMoney ? [['payment', 'Payments']] as [typeof filter, string][] : []), ['message', 'Messages'], ['form', 'Forms']];
  return (
    <section className="space-y-3 rounded-3xl p-5" style={card} aria-label="Everything, in order">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[17px] font-semibold">Everything, in order</h3>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Show">{chips.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => { setFilter(k); setLimit(12); }} className="h-8 rounded-full px-3 text-[13px] font-semibold" style={filter === k ? { background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' } : { background: 'hsl(var(--secondary))' }}>{l}</button>)}</div></div>
      {shown.length === 0 ? <p className="text-[14px]" style={muted}>Nothing here yet.</p> : shown.slice(0, limit).map((e, i) => (
        <div key={i} className="grid gap-3 border-t pt-2.5 text-[14px]" style={{ gridTemplateColumns: '64px 10px 1fr', borderColor: 'hsl(var(--border))' }}>
          <span style={muted}>{format(e.at, e.at.getFullYear() === new Date().getFullYear() ? 'd MMM' : 'd MMM yy')}</span><span className="mt-1.5 h-2.5 w-2.5 rounded-full" style={{ background: dot(e) }} />
          <span className="min-w-0">{e.onOpen ? <button type="button" onClick={e.onOpen} className="text-left hover:underline">{e.title}</button> : e.title}{e.detail ? <span style={e.tone === 'warn' ? { color: 'var(--warn, #b45309)' } : muted}> · {e.detail}</span> : null}</span>
        </div>))}
      {shown.length > limit && <button type="button" onClick={() => setLimit(limit + 20)} className="text-[13px] font-semibold underline underline-offset-2">Show more ({shown.length - limit})</button>}
    </section>);
}

const dur = (s: any) => { const n = Math.max(0, Math.round(Number(s) || 0)); const m = Math.floor(n / 60), r = n % 60; return m ? `${m} min${r ? ` ${r} s` : ''}` : `${r} s`; };
const at = (v: any) => { const d = safe(v); return isNaN(d.getTime()) ? '' : format(d, d.getFullYear() === new Date().getFullYear() ? 'MMM d, h:mm a' : 'MMM d, yyyy, h:mm a'); };
const DECISION: Record<string, string> = { courtesy: 'Courtesy', policy: 'Cancellation', receptionist: 'Receptionist' };
type ConvFilter = 'all' | 'text' | 'email' | 'call' | 'note' | 'decision';
const CONV_FILTERS: [ConvFilter, string][] = [['all', 'All'], ['text', 'Texts'], ['email', 'Emails'], ['call', 'Calls'], ['note', 'Notes'], ['decision', 'Decisions']];
const inFilter = (m: any, f: ConvFilter) => f === 'all' || (f === 'decision' ? m.type in DECISION : m.type === f);

/** A call: length, direction, summary, the recording (fetched signed-in) and the transcript. */
function CallCard({ tenantId, m }: { tenantId: string; m: any }) {
  const c = m.call || {}; const callId = m.meta?.callId; const [src, setSrc] = React.useState<string | null>(null); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => () => { if (src?.startsWith('blob:')) URL.revokeObjectURL(src); }, [src]);
  const play = async () => { setBusy(true); setErr(null);
    try { const { getAuth } = await import('firebase/auth'); const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
      const r = await fetch(`/api/calls/recording?tenantId=${encodeURIComponent(tenantId)}&callId=${encodeURIComponent(callId)}`, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} });
      if (/json/.test(r.headers.get('content-type') || '')) { const j: any = await r.json().catch(() => ({})); if (j?.url) setSrc(j.url); else setErr(j?.error || 'We couldn’t load the recording.'); }
      else if (!r.ok) setErr('We couldn’t load the recording.');
      else setSrc(URL.createObjectURL(await r.blob()));
    } catch { setErr('We couldn’t load the recording. Please check your connection and try again.'); }
    setBusy(false); };
  const dir = c.direction === 'outbound' || m.dir === 'out' ? 'Outbound' : 'Inbound';
  return (
    <div className="w-full space-y-2 rounded-2xl p-3.5 text-[14px]" style={card}>
      <p className="font-semibold">Call · {c.durationSeconds != null ? `${dur(c.durationSeconds)} · ` : ''}{dir}</p>
      {(c.summary || m.text) && <p className="whitespace-pre-wrap">{c.summary || m.text}</p>}
      {c.recording && callId && (src ? <audio controls autoPlay src={src} className="w-full" /> : <button type="button" onClick={play} disabled={busy} className="h-9 rounded-full px-4 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' }}>{busy ? 'Loading…' : 'Play recording'}</button>)}
      {err && <p className="text-[12.5px]" style={{ color: 'var(--warn, #b45309)' }}>{err}</p>}
      {c.transcript && <details><summary className="cursor-pointer text-[13px] font-semibold">Transcript</summary>
        <div className="mt-2 max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-xl p-3 text-[13px] leading-relaxed" style={{ background: 'hsl(var(--secondary))' }}>{c.transcript}</div></details>}
    </div>);
}

/** One entry in the conversation record. */
function ConvRow({ tenantId, m }: { tenantId: string; m: any }) {
  const meta = <span style={muted}>{[m.who, at(m.at)].filter(Boolean).join(' · ')}</span>;
  if (m.type === 'call') return <div className={`flex flex-col ${m.dir === 'in' ? 'items-start' : 'items-end'}`}><div className="w-full max-w-[90%] sm:max-w-[80%]"><CallCard tenantId={tenantId} m={m} /></div><span className="mt-1 text-[11px]">{meta}</span></div>;
  if (m.type === 'note') return (
    <div className="rounded-2xl border border-dashed px-3.5 py-2.5 text-[14px]" style={{ borderColor: 'hsl(var(--border))' }}>
      <p className="text-[12px] font-semibold" style={muted}>Note · {m.who}{m.at ? ` · ${at(m.at)}` : ''}{m.meta?.visibility === 'managers' ? ' · Managers only' : m.meta?.visibility === 'private' ? ' · Just you' : ''}</p>
      <p className="mt-0.5 whitespace-pre-wrap" style={m.status ? { ...muted, textDecoration: 'line-through' } : undefined}>{m.text}</p>
      {m.status && <p className="mt-0.5 text-[12px]" style={muted}>{String(m.status)[0].toUpperCase() + String(m.status).slice(1)}</p>}
    </div>);
  if (m.type in DECISION) return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5 text-[12.5px]" style={muted}>
      {pill(DECISION[m.type])}<span className="min-w-0">{m.text}</span><span className="text-[11px]">· {[m.who, at(m.at)].filter(Boolean).join(' · ')}{m.status && m.type !== 'courtesy' ? ` · ${String(m.status).replace(/_/g, ' ')}` : ''}</span>
    </div>);
  const inboxId = m.meta?.inboxId;
  return (
    <div className={`flex flex-col ${m.dir === 'in' ? 'items-start' : 'items-end'}`}>
      <div className="max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[14px] sm:max-w-[80%]" style={m.dir === 'in' ? { background: 'hsl(var(--secondary))' } : { background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' }}>{m.subject ? <b className="block">{m.subject}</b> : null}{m.text || <i>(no preview)</i>}</div>
      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]" style={muted}>{m.type === 'email' ? 'Email' : 'Text'} · {m.who}{m.kind && m.kind !== 'staff_message' ? ` (${String(m.kind).replace(/_/g, ' ')})` : ''} · {at(m.at)} {m.dir === 'out' && m.status ? (m.status === 'opened' ? pill('Opened', 'ok') : statusPill(m.status)) : null}</span>
      {m.dir === 'in' && m.complaint?.match && <a href={`/cases?start=text${inboxId ? `&inbox=${encodeURIComponent(inboxId)}` : ''}`} className="mt-1 inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-semibold" style={m.complaint.safety ? { background: 'color-mix(in srgb, #b42318 10%, transparent)', color: 'var(--bad-ink)' } : { background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' }}>{m.complaint.safety ? 'Possible safety concern. Start a case' : 'Possible complaint. Start a case'}</a>}
      {m.error && /fail|bounce/.test(m.status) && <span className="text-[11px]" style={{ color: 'var(--warn, #b45309)' }}>{String(m.error).slice(0, 120)}</span>}
    </div>);
}

export function ClientMessages({ tenantId, client, msgs, canSeeContact, canMessage = canSeeContact }: { tenantId: string; client: any; msgs: ReturnType<typeof useClientMessages>; canSeeContact: boolean; canMessage?: boolean }) {
  const [text, setText] = React.useState(''); const [channel, setChannel] = React.useState<'sms' | 'email'>('sms'); const [busy, setBusy] = React.useState(false); const [note, setNote] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<ConvFilter>('all'); const [exporting, setExporting] = React.useState(false); const scroller = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { if (!msgs.canText && msgs.canEmail) setChannel('email'); }, [msgs.canText, msgs.canEmail]);
  const first = String(client.name || 'them').split(' ')[0];
  const shown = (msgs.rows || []).filter((m) => inFilter(m, filter));
  React.useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.rows, filter]);
  const send = async () => { setBusy(true); setNote(null); const r: any = await call({ tenantId, clientId: client.id, action: 'send', text, channel }); setBusy(false);
    if (!r?.ok) { setNote(r?.error || 'It didn’t send.'); return; } setText(''); setNote(r.status === 'sent' ? 'Sent.' : 'Queued.'); void msgs.reload(); };
  const exportCsv = async () => { setExporting(true); setNote(null); const r: any = await call({ tenantId, clientId: client.id, action: 'export' }); setExporting(false);
    if (!r?.ok) { setNote(r?.error || 'We couldn’t export the conversation. Please try again.'); return; }
    const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a');
    a.href = url; a.download = r.filename || 'conversation.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); };
  return (
    <section className="cf-convo space-y-3 rounded-3xl p-5" style={card} aria-label="Conversation">
      <style>{'@media print{.cf-convo-scroll{max-height:none!important;overflow:visible!important}.cf-convo-noprint{display:none!important}}'}</style>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[17px] font-semibold">Conversation</h3>
        <div className="cf-convo-noprint flex gap-1.5"><button type="button" onClick={exportCsv} disabled={exporting} className="h-8 rounded-full px-3 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'hsl(var(--secondary))' }}>{exporting ? 'Exporting…' : 'Export'}</button>
          <button type="button" onClick={() => window.print()} className="h-8 rounded-full px-3 text-[13px] font-semibold" style={{ background: 'hsl(var(--secondary))' }}>Print</button></div></div>
      <div className="cf-convo-noprint flex flex-wrap gap-1" role="tablist" aria-label="Show">{CONV_FILTERS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className="h-8 rounded-full px-3 text-[13px] font-semibold" style={filter === k ? { background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' } : { background: 'hsl(var(--secondary))' }}>{l}</button>)}</div>
      {msgs.error && <p className="text-[14px]" style={{ color: 'var(--warn, #b45309)' }}>{msgs.error}</p>}
      {msgs.rows === null ? <p className="text-[14px]" style={muted}>Loading…</p> : shown.length === 0 ? <p className="text-[14px]" style={muted}>{filter === 'all' ? 'Nothing on the record yet.' : 'Nothing of this kind yet.'}</p> : (
        <div ref={scroller} className="cf-convo-scroll max-h-[560px] space-y-2.5 overflow-y-auto pr-1">{shown.map((m) => <ConvRow key={m.id + m.at} tenantId={tenantId} m={m} />)}</div>)}
      {canMessage && (msgs.canText || msgs.canEmail) ? <div className="cf-convo-noprint space-y-2 border-t pt-3" style={{ borderColor: 'hsl(var(--border))' }}>
        <div className="flex gap-1">{msgs.canText && <button type="button" onClick={() => setChannel('sms')} aria-pressed={channel === 'sms'} className="h-8 rounded-full px-3 text-[13px] font-semibold" style={channel === 'sms' ? { background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' } : { background: 'hsl(var(--secondary))' }}>Text</button>}{msgs.canEmail && <button type="button" onClick={() => setChannel('email')} aria-pressed={channel === 'email'} className="h-8 rounded-full px-3 text-[13px] font-semibold" style={channel === 'email' ? { background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' } : { background: 'hsl(var(--secondary))' }}>Email</button>}</div>
        {!canSeeContact && <p className="text-[12px]" style={muted}>Sent from the business; you won’t see their number or email.</p>}
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={`Write ${channel === 'sms' ? 'a text' : 'an email'} to ${first}…`} aria-label="Message" className="w-full rounded-2xl border p-3 text-[15px]" style={{ borderColor: 'hsl(var(--border))' }} />
        <div className="flex items-center gap-3"><button type="button" onClick={send} disabled={busy || !text.trim()} className="h-10 rounded-full px-5 text-[14px] font-semibold disabled:opacity-50" style={{ background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' }}>{busy ? 'Sending…' : 'Send'}</button>{note && <span className="text-[13px]" style={/Sent|Queued/.test(note) ? { color: 'var(--ok, #15803d)' } : { color: 'var(--warn, #b45309)' }}>{note}</span>}</div>
      </div> : <p className="text-[13px]" style={muted}>{!canMessage ? 'Messaging clients is switched off for staff here.' : canSeeContact ? `No way to reach ${first} — add a mobile number or email.` : `There’s no way to reach ${first} on file.`}</p>}
    </section>);
}

export function ClientFormsNeeded({ appointments, services, consentForms, consents, onOpenVisit }: { appointments: any[]; services: any[]; consentForms: any[]; consents: any[]; onOpenVisit: (a: any) => void }) {
  const now = new Date();
  const upcoming = appointments.filter((a) => safe(a.startTime) > new Date(now.getTime() - 3600000) && !['cancelled', 'declined', 'completed', 'no_show'].includes(String(a.status))).sort((x, y) => safe(x.startTime).getTime() - safe(y.startTime).getTime()).slice(0, 4);
  const formName = (id: string) => consentForms.find((f) => f.id === id)?.name || consentForms.find((f) => f.id === id)?.title || 'A form';
  // The one rule (lib/forms): signed for that visit, or a signed copy on file in the form's current wording and within
  // the time limit (a copy taken back, revokedAt, doesn't count).
  const rules = formRulesOf(useTenantOptional()?.selectedTenant);
  const rows = upcoming.flatMap((a) => { const svc = services.find((s) => s.id === a.serviceId); const need = formsAskedFor(a, svc ? [svc] : []); const signed = signedOnVisit(a); const waived = waivedOnVisit(a);
    // A form that no longer exists can't be opened or signed, so it's never listed (once the forms have loaded).
    return need.filter((id) => !consentForms.length || consentForms.some((f) => f.id === id)).map((id) => { const sc = consents.find((c) => (c.formId || c.consentFormId) === id && !c.revokedAt);
      const st = formStateOf(consentForms.find((f) => f.id === id) || null, sc ? { signedAt: sc.signedAt, version: sc.version || null, guardian: !!sc.guardianName } : null, rules, safe(a.startTime));
      return { a, id, ok: signed.has(id) || st === 'current', waived: waived.has(id) && !signed.has(id) && st !== 'current' }; }); });
  const due = rows.filter((r) => !r.ok && !r.waived);
  return (
    <section className="space-y-2 rounded-3xl p-5" style={card} aria-label="Forms needed">
      <h3 className="text-[17px] font-semibold">{due.length ? `${due.length} form${due.length === 1 ? '' : 's'} to sign before ${due.length === 1 ? format(safe(due[0].a.startTime), 'EEEE') : 'upcoming visits'}` : upcoming.length ? 'Nothing to sign before their next visit' : 'No upcoming visits'}</h3>
      {rows.map((r, i) => (<div key={i} className="flex items-center justify-between gap-3 border-t pt-2 text-[14px]" style={{ borderColor: 'hsl(var(--border))' }}>
        <span className="min-w-0"><b>{formName(r.id)}</b><span style={muted}> · for {format(safe(r.a.startTime), 'EEE, MMM d')}</span></span>
        {r.ok ? pill('Signed', 'ok') : r.waived ? pill('Waived for this visit') : <button type="button" onClick={() => onOpenVisit(r.a)} className="min-h-11 shrink-0 rounded-full px-3 text-[12px] font-semibold" style={{ background: 'color-mix(in srgb, var(--warn, #b45309) 12%, transparent)', color: 'var(--warn, #b45309)' }}>Send from the visit</button>}
      </div>))}
      <p className="text-[12px]" style={muted}>Everything signed is listed below, with when and who signed.</p>
    </section>);
}

/** Photos (board 18D): every photo of the client — inspiration they sent (and earlier ones), how it looked before, after
 *  photos, and photos brought over from another app — by kind, grouped by visit (date, service, who did it), newest
 *  first. Choosing one opens its record beside the photos on a computer, or over them on a phone (ClientPhotoRecord). */
export function ClientPhotos({ tenantId, client, appointments, services, staff = [], me = {}, isManager = false }: { tenantId?: string | null; client: any; appointments: any[]; services: any[]; staff?: any[]; me?: { uid?: string | null; name?: string | null }; isManager?: boolean }) {
  const tctx: any = useTenantOptional(); const zone = tenantTimeZone(tctx?.selectedTenant);
  const [kind, setKind] = React.useState<string>('all'); const [sel, setSel] = React.useState<string | null>(null); const [said, setSaid] = React.useState<string | null>(null);
  const [wide, setWide] = React.useState(false); const lastTile = React.useRef<HTMLElement | null>(null); const saidRef = React.useRef<HTMLParagraphElement | null>(null);
  // After a photo is removed (its tile is gone), the focus goes to what was said about it.
  React.useEffect(() => { if (said) setTimeout(() => saidRef.current?.focus({ preventScroll: false }), 0); }, [said]);
  React.useEffect(() => { const q = window.matchMedia?.('(min-width: 1024px)'); if (!q) return; const f = () => setWide(q.matches); f(); q.addEventListener?.('change', f); return () => q.removeEventListener?.('change', f); }, []);
  const { visits, imported } = React.useMemo(() => clientPhotos({ client, appointments, services, staff }), [client, appointments, services, staff]);
  const counts = filterCounts(visits, imported); const kinds = PHOTO_FILTERS.find((f) => f.key === kind)?.kinds || PHOTO_FILTERS[0].kinds;
  const all = [...visits.flatMap((v) => v.photos), ...imported]; const chosen = sel ? all.find((p) => `${p.apptId || 'old'}:${p.id}` === sel) || null : null;
  React.useEffect(() => { if (sel && !chosen) setSel(null); }, [sel, chosen]);
  // A filter with nothing left in it (its last photo removed) goes back to All.
  React.useEffect(() => { if (kind !== 'all' && !counts[kind]) setKind('all'); }, [kind, counts[kind]]);   // eslint-disable-line react-hooks/exhaustive-deps
  // On a phone the record covers the page: Escape closes it (not while the markup tool, or a question, is open over it),
  // and the photo chosen gets the focus back.
  const close = () => { setSel(null); const t = lastTile.current; if (t) setTimeout(() => { try { t.focus({ preventScroll: true }); } catch { /* gone */ } }, 0); };
  React.useEffect(() => { if (!chosen || wide) return; const k = (e: KeyboardEvent) => { if (e.key !== 'Escape' || document.querySelector('[data-markup-editor], [role=alertdialog]')) return; close(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [chosen, wide]);   // eslint-disable-line react-hooks/exhaustive-deps
  const oldDocs = (Array.isArray(client.importedFiles) ? client.importedFiles : []).filter((f: any) => f?.kind !== 'photo');
  const ok = client.marketingConsent?.consented === true; const name = String(client.name || '').split(' ')[0] || 'They';
  const tile = (p: ClientPhoto) => { const id = `${p.apptId || 'old'}:${p.id}`; const on = sel === id; return (
    <button key={id} type="button" onClick={(e) => { lastTile.current = e.currentTarget; setSel(on && wide ? null : id); setSaid(null); }} aria-pressed={on} aria-label={`${PHOTO_LABEL[p.kind]} photo ${p.n}${p.note ? `: ${p.note}` : ''}`}
      className="relative aspect-square overflow-hidden rounded-2xl outline-none focus-visible:ring-2" style={{ background: 'hsl(var(--secondary))', boxShadow: on ? '0 0 0 2px hsl(var(--card)), 0 0 0 4px hsl(var(--foreground))' : undefined }}>
      <TileImg url={p.url} /><span className="absolute bottom-1.5 left-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: 'rgba(22,23,26,.74)', color: '#fff' }}>{p.kind === 'earlier' ? 'Earlier' : PHOTO_LABEL[p.kind]}</span></button>); };
  const shownVisits = visits.map((v) => ({ ...v, photos: v.photos.filter((p) => kinds.includes(p.kind)) })).filter((v) => v.photos.length);
  const shownOld = imported.filter((p) => kinds.includes(p.kind));
  const appt = chosen?.apptId ? appointments.find((a) => String(a?.id) === chosen.apptId) || null : null;
  const record = chosen && tenantId ? <ClientPhotoRecord key={sel!} tenantId={tenantId} client={client} photo={chosen} appt={appt} zone={zone} me={me} isManager={isManager}
    nowUrl={appt?.nowPhoto?.url || null} onRemoved={(t) => { setSel(null); setSaid(t); }} /> : null;
  return (
    <section className="space-y-4 rounded-3xl p-5" style={card} aria-label="Photos">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[17px] font-semibold">{all.length ? `${all.length} photo${all.length === 1 ? '' : 's'}` : 'Photos'}</h3>
        <span>{ok ? pill('OK to share in marketing', 'ok') : pill('Not for marketing')}</span></div>
      {all.length > 0 && <div className="flex flex-wrap gap-2" role="group" aria-label="Show">{PHOTO_FILTERS.filter((f) => f.key === 'all' || counts[f.key]).map((f) => <button key={f.key} type="button" aria-pressed={kind === f.key} onClick={() => setKind(f.key)} className="inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-semibold" style={kind === f.key ? { background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' } : { background: 'hsl(var(--secondary))' }}>{f.label} {counts[f.key]}</button>)}</div>}
      {said && <p ref={saidRef} tabIndex={-1} className="text-[14px] outline-none" role="status" style={{ color: '#1f7a4d' }}>{said}</p>}
      <div className={wide && all.length ? 'grid grid-cols-[minmax(0,1fr)_380px] items-start gap-6' : ''}>
        <div className="space-y-5">
          {all.length === 0 && !oldDocs.length && <p className="text-[14px]" style={muted}>No photos yet. Inspiration {name.toLowerCase() === 'they' ? 'they' : name} sends when booking, how it looks before, and after photos from a visit appear here.</p>}
          {shownVisits.map((v) => (<div key={v.apptId} className="space-y-2">
            <p className="text-[13.5px]"><b>{v.at ? format(wallDate(new Date(v.at), zone), 'MMM d, yyyy') : 'A visit'}</b><span style={muted}> · {v.service}{v.provider ? ` · ${v.provider}` : ''}</span></p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">{v.photos.map(tile)}</div></div>))}
          {(shownOld.length > 0 || (oldDocs.length > 0 && kind === 'all')) && <div className="space-y-2">
            <p className="text-[13.5px]"><b>Brought over from {client.importedFiles?.[0]?.importedFrom || 'your old app'}</b><span style={muted}> · {imported.length} photo{imported.length === 1 ? '' : 's'}{oldDocs.length ? `, ${oldDocs.length} file${oldDocs.length === 1 ? '' : 's'}` : ''}</span></p>
            {shownOld.length > 0 && <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">{shownOld.map(tile)}</div>}
            {oldDocs.length > 0 && kind === 'all' && <ul className="space-y-1">{oldDocs.map((f: any) => <li key={f.url}><a href={f.url} target="_blank" rel="noreferrer" className="text-[13.5px] underline underline-offset-4">{f.name}</a></li>)}</ul>}</div>}
        </div>
        {wide && all.length > 0 && <div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[24px]">{record || <p className="rounded-[24px] p-6 text-center text-[14px]" style={{ ...muted, border: '1px dashed hsl(var(--border))' }}>Choose a photo to see its record: its layers, what it may be used for, and who has opened it.</p>}</div>}
      </div>
      {!wide && record && <div role="dialog" aria-modal="true" aria-label="A photo’s record" className="fixed inset-0 z-[300] overflow-y-auto" style={{ background: 'hsl(var(--background))' }}>
        <div className="sticky top-0 z-10 flex items-center px-2" style={{ minHeight: 52, background: 'hsl(var(--background))', paddingTop: 'env(safe-area-inset-top,0px)' }}>
          <button type="button" autoFocus onClick={close} className="inline-flex min-h-11 items-center px-2 text-[16px] font-semibold">‹ Photos</button></div>
        <div className="px-3 pb-8">{record}</div></div>}
    </section>);
}
/** A tile's photo (opened with the team's sign-in when it's private). */
function TileImg({ url }: { url: string }) { const src = usePrivateUrl(url); return src ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" /> : null; }

async function notesCall(body: any) { const { getAuth } = await import('firebase/auth'); const tk = await getAuth().currentUser?.getIdToken().catch(() => '') || '';
  return fetch('/api/clients/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => null); }
const VIS: Record<string, string> = { team: 'The team', managers: 'Managers only', private: 'Just me' };

/** Notes: what the team should know, each saying who wrote it, when, and who can see it. Visibility is enforced on the server. */
export function ClientNotes({ tenantId, client }: { tenantId: string; client: any }) {
  const [rows, setRows] = React.useState<any[] | null>(null); const [isManager, setIsManager] = React.useState(false); const [err, setErr] = React.useState<string | null>(null);
  const [text, setText] = React.useState(''); const [vis, setVis] = React.useState<'team' | 'managers' | 'private'>('team'); const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => { const r: any = await notesCall({ tenantId, action: 'list', clientId: client.id }); if (r?.ok) { setRows(r.rows); setIsManager(!!r.isManager); } else { setRows([]); setErr(r?.error || 'Couldn’t load notes.'); } }, [tenantId, client.id]);
  React.useEffect(() => { void load(); }, [load]);
  const add = async () => { setBusy(true); setErr(null); const r: any = await notesCall({ tenantId, action: 'add', clientId: client.id, text, visibility: vis }); setBusy(false); if (!r?.ok) { setErr(r?.error || 'Couldn’t save that.'); return; } setText(''); void load(); };
  const act = async (id: string, action: string) => { const r: any = await notesCall({ tenantId, action, id }); if (!r?.ok) setErr(r?.error || 'Couldn’t do that.'); void load(); };
  return (
    <section className="space-y-3 rounded-3xl p-5" style={card} aria-label="Notes">
      <h3 className="text-[17px] font-semibold">What the team should know</h3>
      {err && <p className="text-[13px]" style={{ color: 'var(--warn, #b45309)' }}>{err}</p>}
      {rows === null ? <p className="text-[14px]" style={muted}>Loading…</p> : rows.length === 0 ? <p className="text-[14px]" style={muted}>No notes yet.</p> : rows.map((n) => (
        <div key={n.id} className="flex items-start justify-between gap-3 border-t pt-3 text-[14px]" style={{ borderColor: 'hsl(var(--border))' }}>
          <div className="min-w-0"><p className="whitespace-pre-wrap">{n.pinned ? '📌 ' : ''}{n.text}</p><p className="mt-1 text-[12px]" style={muted}>{n.authorName}{n.at ? ` · ${format(safe(n.at), 'd MMM yyyy')}` : ''}{n.legacy ? ' · from their profile' : ''}</p>
            {!n.legacy && <span className="mt-1 flex gap-3 text-[12px]">{(isManager || n.mine) && <button type="button" onClick={() => act(n.id, n.pinned ? 'unpin' : 'pin')} className="font-semibold underline underline-offset-2">{n.pinned ? 'Unpin' : 'Pin to top'}</button>}{n.mine && <button type="button" onClick={() => { if (window.confirm('Delete this note?')) void act(n.id, 'delete'); }} style={muted}>Delete</button>}</span>}</div>
          {pill(VIS[n.visibility] || 'The team', n.visibility === 'managers' ? 'warn' : 'soft')}
        </div>))}
      <div className="space-y-2 border-t pt-3" style={{ borderColor: 'hsl(var(--border))' }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={`A note about ${String(client.name || 'them').split(' ')[0]}…`} aria-label="New note" className="w-full rounded-2xl border p-3 text-[15px]" style={{ borderColor: 'hsl(var(--border))' }} />
        <div className="flex flex-wrap items-center gap-2"><span className="text-[13px]" style={muted}>Who can see it:</span>
          {(['team', ...(isManager ? ['managers'] : []), 'private'] as const).map((v) => <button key={v} type="button" onClick={() => setVis(v as any)} aria-pressed={vis === v} className="h-8 rounded-full px-3 text-[13px] font-semibold" style={vis === v ? { background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' } : { background: 'hsl(var(--secondary))' }}>{VIS[v]}</button>)}
          <button type="button" onClick={add} disabled={busy || !text.trim()} className="ml-auto h-10 rounded-full px-5 text-[14px] font-semibold disabled:opacity-50" style={{ background: 'hsl(var(--foreground))', color: 'hsl(var(--background))' }}>{busy ? 'Saving…' : 'Save note'}</button></div>
      </div>
    </section>);
}
