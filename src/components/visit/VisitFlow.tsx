'use client';
// The visit, at a glance, in the order it happens (canvas "Planner on a phone", boards 7–15):
//   ReadyCard        before they start: the checklist the business chose (lib/visit-readiness), "Send what's missing"
//   ChairCard        in the chair: the one live timer (lib/visit-clock), how long it should take, add an add-on
//   AfterCard        afterwards: paid, aftercare, how was it, next visit
//   SendToClient     every link a client can be sent from a visit, in one place
import { useMemo, useState } from 'react';
import { Check, ChevronRight, Clock, Plus, Send } from 'lucide-react';
import { readinessOf } from '@/lib/visit-readiness';
import { visitClock } from '@/lib/visit-clock';
import { useNow } from '@/components/planner/AgendaView';
import { ITEM_WORDS, type RequestItem } from '@/lib/visit-requests';

const INK = '#16171a', MUTED = '#6d7075', LINE = 'var(--line, #ececee)', GREEN = '#1f7a4d', MINT = '#7fd1a5', AMBER = '#b45309';
const box = { border: `1px solid ${LINE}`, borderRadius: 20, padding: '14px 16px' } as const;

function Dot({ state }: { state: 'done' | 'waiting' | 'missing' }) {
  if (state === 'done') return <span aria-label="Done" style={{ width: 24, height: 24, borderRadius: 999, background: 'rgba(127,209,165,.25)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Check size={13} strokeWidth={3} color={GREEN} /></span>;
  return <span aria-label={state === 'waiting' ? 'Waiting' : 'Not done'} style={{ width: 24, height: 24, borderRadius: 999, border: `1.5px solid ${state === 'waiting' ? '#e2b07a' : '#d6d7da'}`, flexShrink: 0 }} />;
}

export function ReadyCard({ appointment, service, client, tenant, forms, onSendMissing, onOpenSend, sending }: { appointment: any; service: any; client: any; tenant: any; forms?: any[]; onSendMissing: (items: RequestItem[]) => void; onOpenSend: () => void; sending?: boolean }) {
  const r = useMemo(() => readinessOf(appointment, service, client, tenant, forms), [appointment, service, client, tenant, forms]);
  if (!r.items.length) return null;
  const left = r.items.length - r.done;
  return (
    <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 15.5, fontWeight: 600 }}>Ready for the visit</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: left ? AMBER : GREEN }}>{left ? `${r.done} of ${r.items.length}` : 'All set'}</span>
      </div>
      {r.items.map((i) => (
        <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0' }}>
          <Dot state={i.state} />
          <span style={{ flex: 1, fontSize: 14.5 }}>{i.label}{i.rule === 'block' && i.state !== 'done' && <span style={{ fontSize: 12, color: AMBER, marginLeft: 6 }}>needed to start</span>}</span>
          <span style={{ fontSize: 12.5, color: i.state === 'done' ? MUTED : AMBER, textAlign: 'right' }}>{i.detail}</span>
        </div>))}
      {r.missing.length > 0 && <button type="button" disabled={sending} onClick={() => onSendMissing(r.missing)} style={{ marginTop: 8, height: 46, borderRadius: 999, border: 0, background: INK, color: '#fff', font: 'inherit', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', opacity: sending ? 0.6 : 1 }}>{sending ? 'Sending…' : 'Send what’s missing'}</button>}
      <button type="button" onClick={onOpenSend} style={{ marginTop: 6, alignSelf: 'center', border: 0, background: 'none', font: 'inherit', fontSize: 13.5, fontWeight: 600, color: INK, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Send size={14} />More to send</button>
    </div>);
}

export function ChairCard({ appointment, service, allServices, client, onAddOn }: { appointment: any; service: any; allServices: any[]; client: any; onAddOn?: () => void }) {
  useNow(1000);
  const c = visitClock(appointment, service, allServices); if (!c) return null;
  const pct = c.expected ? Math.min(100, Math.round((c.secs / 60 / c.expected) * 100)) : 0;
  const started = new Date(Date.parse(String(appointment.actualStartTime || appointment.serviceStartedAt))).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const usual = Number(appointment.clientExtraMinutes) || 0;
  return (
    <div style={{ borderRadius: 22, background: INK, color: '#fff', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#c9cace' }}><span>Started {started}</span><span>{c.expected ? `${c.expected} min${usual ? ` (usually +${usual} for ${String(client?.name || '').split(' ')[0] || 'them'})` : ''}` : ''}</span></div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 48, fontWeight: 300, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{c.label}</span>
        <span style={{ fontSize: 14, color: c.over ? '#fca5a5' : MINT }}>{c.over ? `${c.overMinutes} min over` : c.leftMinutes !== null ? `${c.leftMinutes} min left` : ''}</span>
      </div>
      {c.expected > 0 && <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,.12)' }}><div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: c.over ? '#f87171' : MINT, transition: 'width 1s linear' }} /></div>}
      {onAddOn && <button type="button" onClick={onAddOn} style={{ alignSelf: 'flex-start', height: 38, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(255,255,255,.25)', background: 'transparent', color: '#fff', font: 'inherit', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><Plus size={14} />Add an add-on</button>}
    </div>);
}

export function AfterCard({ appointment, nextVisit, suggestDate, onBookNext, onSend }: { appointment: any; nextVisit?: any; suggestDate?: string | null; onBookNext: () => void; onSend: (kind: 'aftercare' | 'review' | 'rebook') => void }) {
  const a = appointment || {}; const sent = a.sent || {};
  const when = (iso?: string) => { const t = Date.parse(String(iso || '')); return t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
  const rows: { label: string; state: 'done' | 'waiting' | 'missing'; detail: string; act?: () => void; actLabel?: string }[] = [
    { label: 'Paid', state: a.status === 'completed' ? 'done' : 'missing', detail: a.status === 'completed' ? (a.revenue ? `$${Number(a.revenue).toFixed(0)}` : 'done') : 'not yet' },
    { label: 'Aftercare', state: a.aftercareSentAt || sent.aftercare ? 'done' : 'waiting', detail: a.aftercareSentAt || sent.aftercare ? `sent ${when(a.aftercareSentAt || sent.aftercare?.at)}` : 'goes out after the visit', act: () => onSend('aftercare'), actLabel: a.aftercareSentAt ? 'Resend' : 'Send now' },
    { label: 'How was it?', state: a.reviewSubmittedAt ? 'done' : a.followUpSentAt || sent.review ? 'waiting' : 'waiting', detail: a.reviewSubmittedAt ? (a.reviewRating ? `${a.reviewRating} of 5` : 'answered') : a.followUpSentAt || sent.review ? `asked ${when(a.followUpSentAt || sent.review?.at)}` : 'asked the next day', act: () => onSend('review'), actLabel: 'Ask now' },
    { label: 'Next visit', state: nextVisit ? 'done' : 'missing', detail: nextVisit ? when(nextVisit.startTime) : 'not booked' },
  ];
  return (
    <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 6 }}>Afterwards</div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0' }}>
          <Dot state={r.state} /><span style={{ flex: 1, fontSize: 14.5 }}>{r.label}</span>
          <span style={{ fontSize: 12.5, color: r.state === 'missing' ? AMBER : MUTED }}>{r.detail}</span>
          {r.act && r.state !== 'done' && <button type="button" onClick={r.act} style={{ border: 0, background: 'none', font: 'inherit', fontSize: 13, fontWeight: 600, color: INK, cursor: 'pointer', padding: 0 }}>{r.actLabel}</button>}
        </div>))}
      {!nextVisit && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 8 }}>
        <button type="button" onClick={onBookNext} style={{ height: 44, borderRadius: 999, border: 0, background: INK, color: '#fff', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{suggestDate ? `Book ${suggestDate}` : 'Book next visit'}</button>
        <button type="button" onClick={() => onSend('rebook')} style={{ height: 44, borderRadius: 999, border: `1px solid ${LINE}`, background: '#fff', font: 'inherit', fontSize: 14, fontWeight: 600, color: INK, cursor: 'pointer' }}>Send a link</button>
      </div>}
    </div>);
}

/** Every link a client can be sent from a visit, grouped by when. */
export function SendToClient({ open, onClose, appointment, service, client, tenant, forms, onSendRequests, onSendKind, onRunningLate }: { open: boolean; onClose: () => void; appointment: any; service: any; client: any; tenant: any; forms?: any[];
  onSendRequests: (items: RequestItem[]) => Promise<void> | void; onSendKind: (kind: 'aftercare' | 'review' | 'rebook' | 'visit_link') => Promise<void> | void; onRunningLate: (minutes: number) => Promise<void> | void }) {
  const r = useMemo(() => readinessOf(appointment, service, client, tenant, forms), [appointment, service, client, tenant, forms]);
  const [extra, setExtra] = useState<RequestItem[]>([]); const [late, setLate] = useState(false); const [busy, setBusy] = useState(false);
  if (!open) return null;
  const first = String(client?.name || appointment?.clientName || 'them').split(' ')[0];
  const items = [...new Set([...r.missing, ...extra])];
  const toggle = (k: RequestItem) => setExtra((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));
  const run = async (f: () => any) => { setBusy(true); try { await f(); } finally { setBusy(false); } };
  const done = ['completed', 'ready_for_checkout'].includes(String(appointment?.status));
  const btn = { height: 46, borderRadius: 14, border: `1px solid ${LINE}`, background: '#fff', font: 'inherit', fontSize: 13.5, fontWeight: 600, color: INK, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 } as const;
  const head = { fontSize: 12, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase' as const, color: MUTED, marginTop: 8 };
  return (
    <div role="dialog" aria-label={`Send to ${first}`} onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(22,23,26,.38)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, maxHeight: '92dvh', overflowY: 'auto', background: '#fff', color: INK, borderRadius: '28px 28px 0 0', padding: '10px 18px 26px', display: 'flex', flexDirection: 'column', gap: 10, fontFamily: 'inherit' }}>
        <div style={{ width: 40, height: 5, borderRadius: 999, background: '#d6d7da', alignSelf: 'center' }} />
        <div style={{ fontSize: 22, fontWeight: 300, letterSpacing: '-0.02em' }}>Send to {first}</div>
        {!done && <>
          <div style={head}>Before the visit</div>
          <div style={{ border: `1px solid ${LINE}`, borderRadius: 18, overflow: 'hidden' }}>
            {r.items.filter((i) => i.request).map((i) => (
              <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: `1px solid ${LINE}` }}>
                <Dot state={i.state} /><span style={{ flex: 1, fontSize: 14.5 }}>{i.request ? ITEM_WORDS[i.request].label : i.label}</span><span style={{ fontSize: 12, color: i.state === 'done' ? GREEN : AMBER }}>{i.state === 'done' ? 'done' : 'will ask'}</span>
              </div>))}
            {(['inspo', 'photo_current'] as RequestItem[]).filter((k) => !r.items.some((i) => i.request === k)).map((k) => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: `1px solid ${LINE}`, cursor: 'pointer' }}>
                <input type="checkbox" checked={extra.includes(k)} onChange={() => toggle(k)} style={{ width: 20, height: 20, accentColor: INK }} /><span style={{ flex: 1, fontSize: 14.5 }}>{ITEM_WORDS[k].label}</span>
              </label>))}
          </div>
          <button type="button" disabled={busy || !items.length} onClick={() => run(() => onSendRequests(items))} style={{ height: 48, borderRadius: 999, border: 0, background: INK, color: '#fff', font: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: busy || !items.length ? 0.45 : 1 }}>{items.length ? `Send ${items.length} request${items.length === 1 ? '' : 's'}` : 'Nothing to ask for'}</button>
          <div style={head}>Today</div>
          {!late ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <button type="button" style={btn} onClick={() => setLate(true)}><Clock size={14} />We’re running late</button>
            <button type="button" style={btn} disabled={busy} onClick={() => run(() => onSendKind('visit_link'))}>Their visit link</button>
          </div> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
            {[5, 10, 15, 20].map((m) => <button key={m} type="button" style={btn} disabled={busy} onClick={() => run(async () => { await onRunningLate(m); setLate(false); })}>{m} min</button>)}
          </div>}
        </>}
        <div style={head}>After the visit</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <button type="button" style={btn} disabled={busy} onClick={() => run(() => onSendKind('aftercare'))}>Aftercare</button>
          <button type="button" style={btn} disabled={busy} onClick={() => run(() => onSendKind('review'))}>Ask how it went</button>
          <button type="button" style={btn} disabled={busy} onClick={() => run(() => onSendKind('rebook'))}>Book your next visit</button>
          <button type="button" style={btn} onClick={onClose}>Done<ChevronRight size={14} /></button>
        </div>
      </div>
    </div>);
}
