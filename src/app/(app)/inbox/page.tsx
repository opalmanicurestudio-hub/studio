'use client';
// src/app/(app)/inbox/page.tsx — INBOX: everything clients send us (texts, emails and messages from their visit link), newest first. Opening a message
// marks it read; a reply goes out from the business's number or email and is saved to the client's record. Messages
// from a number or address we don't know can be linked to a client here. /api/inbox, lib/conversation.
import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { collection, getDocs, limit as qLimit, orderBy, query, where } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { useFirebase } from '@/firebase';
import { AppHeader } from '@/components/shared/AppHeader';
import { payPost } from '@/components/pay/pay-client';

const muted = { color: 'var(--muted, #6b635c)' } as React.CSSProperties;
const card = { background: 'var(--card, #fff)', border: '1px solid var(--line, #e7e2dc)' } as React.CSSProperties;
const ink = { background: 'var(--ink, #1c1917)', color: '#fff' } as React.CSSProperties;
const soft = { background: 'var(--soft, #efebe6)' } as React.CSSProperties;
const warn = { color: 'var(--warn, #b45309)' } as React.CSSProperties;
const okc = { color: 'var(--ok, #15803d)' } as React.CSSProperties;
const chip = (label: string, style: React.CSSProperties = soft) => <span className="inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold" style={style}>{label}</span>;
const when = (v: any) => { const d = new Date(v); if (isNaN(d.getTime())) return ''; const now = new Date();
  return d.toDateString() === now.toDateString() ? format(d, 'h:mm a') : d.getFullYear() === now.getFullYear() ? format(d, 'MMM d, h:mm a') : format(d, 'MMM d, yyyy'); };
const ACTION: Record<string, string> = { confirmed: 'Their appointment was confirmed by this reply.', cancel_requested: 'They asked to cancel.', ambiguous_appointment: 'They replied, but they have more than one upcoming appointment. Please check which one they mean.' };
const FILTERS: [Filter, string][] = [['unread', 'Unread'], ['all', 'All'], ['unknown', 'Not linked']];
type Filter = 'unread' | 'all' | 'unknown';
const LINKS: [string, string][] = [['cancel', 'Cancel'], ['reschedule', 'Reschedule'], ['message', 'Message'], ['', 'Visit']];

/** Find a client by name (the start of their first or full name). */
function ClientFinder({ tenantId, onPick, onCancel }: { tenantId: string; onPick: (c: { id: string; name: string }) => void; onCancel: () => void }) {
  const { firestore } = useFirebase(); const [q, setQ] = React.useState(''); const [res, setRes] = React.useState<{ id: string; name: string; phone?: string; email?: string }[] | null>(null);
  React.useEffect(() => {
    const term = q.trim(); if (!firestore || !tenantId || term.length < 2) { setRes(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      const col = collection(firestore, `tenants/${tenantId}/clients`);
      const forms = Array.from(new Set([term, term[0].toUpperCase() + term.slice(1), term.toLowerCase()]));
      const found = new Map<string, any>();
      await Promise.all(forms.map(async (f) => { try {
        const snap = await getDocs(query(col, where('name', '>=', f), where('name', '<=', `${f}`), orderBy('name'), qLimit(8)));
        snap.docs.forEach((d) => { const c: any = d.data(); if (c.status !== 'archived') found.set(d.id, { id: d.id, name: String(c.name || 'Client'), phone: c.phone || '', email: c.email || '' }); });
      } catch { /* a missing index or permission: show nothing */ } }));
      if (live) setRes(Array.from(found.values()).slice(0, 8));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, firestore, tenantId]);
  return (
    <div className="space-y-2 rounded-2xl p-3" style={soft}>
      <div className="flex items-center gap-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients by name" aria-label="Search clients by name" className="h-10 min-w-0 flex-1 rounded-full border bg-white px-4 text-[14px]" style={{ borderColor: 'var(--line, #e7e2dc)' }} />
        <button type="button" onClick={onCancel} className="text-[13px] underline underline-offset-2" style={muted}>Cancel</button></div>
      {res && (res.length === 0 ? <p className="px-1 text-[13px]" style={muted}>No clients found with that name.</p> : <ul className="space-y-1">{res.map((c) => (
        <li key={c.id}><button type="button" onClick={() => onPick(c)} className="flex w-full items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-left text-[14px] hover:opacity-90">
          <b className="truncate">{c.name}</b><span className="truncate text-[12px]" style={muted}>{c.phone || c.email}</span></button></li>))}</ul>)}
    </div>);
}

function InboxItem({ m, tenantId, open, onToggle, onChanged }: { m: any; tenantId: string; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const email = m.channel === 'email'; const app = m.channel === 'app'; const unread = !m.readAt;
  const boxRef = React.useRef<HTMLTextAreaElement | null>(null); const [linkBusy, setLinkBusy] = React.useState<string | null>(null);
  const [text, setText] = React.useState(''); const [subject, setSubject] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ ok: boolean; t: string } | null>(null); const [linking, setLinking] = React.useState(false);
  const name = m.clientId ? (m.clientName || 'Client') : null; const fromLabel = m.fromName && m.from ? `${m.fromName} · ${m.from}` : m.fromName || m.from || 'Unknown sender';
  const body = m.body || (m.mediaCount ? `${m.mediaCount} photo${m.mediaCount === 1 ? '' : 's'}` : '');
  const reply = async () => { setBusy(true); setNote(null);
    const r = await payPost('/api/inbox', { tenantId, action: 'reply', id: m.id, text, ...(email && subject.trim() ? { subject: subject.trim() } : {}) }); setBusy(false);
    if (!r?.ok) { setNote({ ok: false, t: r?.error || 'The reply could not be sent.' }); return; }
    setText(''); setSubject(''); setNote({ ok: true, t: 'Your reply was sent.' }); onChanged(); };
  // "Send their link": the visit link for their next appointment, opened to an action, put into the reply at the cursor.
  const insertLink = async (act: string) => { setLinkBusy(act); setNote(null);
    const r = await payPost('/api/inbox', { tenantId, action: 'link_for', clientId: m.clientId, ...(act ? { do: act } : {}) }); setLinkBusy(null);
    if (!r?.ok || !r.url) { setNote({ ok: false, t: r?.error || 'We couldn’t get their link.' }); return; }
    const el = boxRef.current; const url = String(r.url);
    const at = el && document.activeElement === el ? el.selectionStart : null; const end = el && document.activeElement === el ? el.selectionEnd : null;
    setText((cur) => {
      if (at == null || end == null) return cur ? `${cur.replace(/\s+$/, '')} ${url}` : url;
      const before = cur.slice(0, at); const after = cur.slice(end);
      return `${before}${before && !/\s$/.test(before) ? ' ' : ''}${url}${after && !/^\s/.test(after) ? ' ' : ''}${after}`;
    }); };
  const link = async (c: { id: string; name: string }) => { setNote(null);
    const r = await payPost('/api/inbox', { tenantId, action: 'link', id: m.id, clientId: c.id });
    if (!r?.ok) { setNote({ ok: false, t: r?.error || 'We could not link this message.' }); return; }
    setLinking(false); setNote({ ok: true, t: `Linked to ${c.name}. It’s now on their record.` }); onChanged(); };
  return (
    <li className="rounded-3xl p-4" style={{ ...card, ...(unread ? { borderColor: 'var(--ink, #1c1917)' } : {}) }}>
      <div className="flex items-start gap-3">
        <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: unread ? 'var(--accent, #2e6f6a)' : 'transparent' }} aria-hidden />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {name ? <Link href={`/clients/${m.clientId}`} className="text-[15px] font-semibold underline-offset-2 hover:underline">{name}</Link> : <span className="break-all text-[15px] font-semibold">{fromLabel}</span>}
            {chip(email ? 'Email' : app ? 'App' : 'Text')}
            {m.complaint?.match && chip(m.complaint.safety ? 'Possible safety concern' : 'Possible complaint', m.complaint.safety ? { background: '#fdecec', color: '#b42318' } : { background: 'color-mix(in srgb, var(--warn, #b45309) 12%, transparent)', color: 'var(--warn, #b45309)' })}
            <span className="ml-auto whitespace-nowrap text-[12px]" style={muted}>{when(m.at)}</span>
          </div>
          <button type="button" onClick={onToggle} aria-expanded={open} className="block w-full text-left">
            {email && m.subject ? <b className="block text-[14px]">{m.subject}</b> : null}
            <p className={`whitespace-pre-wrap break-words text-[14px] ${open ? '' : 'line-clamp-2'}`} style={unread ? undefined : { opacity: 0.85 }}>{body || <i style={muted}>(no message)</i>}</p>
            {!open && <span className="text-[12px] font-semibold underline underline-offset-2" style={muted}>Open</span>}
          </button>
          {(m.readBy?.name || m.repliedBy?.name || m.actionTaken) && <p className="text-[12px]" style={muted}>
            {[m.repliedBy?.name ? `Replied by ${m.repliedBy.name}${m.repliedAt ? ` · ${when(m.repliedAt)}` : ''}` : m.readBy?.name ? `Read by ${m.readBy.name}` : null, m.actionTaken ? ACTION[m.actionTaken] || null : null].filter(Boolean).join(' · ')}</p>}
          {open && <div className="space-y-2.5 pt-1">
            {m.complaint?.match && <a href={`/cases?start=text&inbox=${encodeURIComponent(m.id)}`} className="inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold" style={m.complaint.safety ? { background: '#fdecec', color: '#b42318' } : ink}>Start a case</a>}
            {!m.clientId && (linking ? <ClientFinder tenantId={tenantId} onPick={link} onCancel={() => setLinking(false)} />
              : <button type="button" onClick={() => setLinking(true)} className="h-9 rounded-full px-4 text-[13px] font-semibold" style={soft}>Link to a client</button>)}
            <div className="space-y-2 border-t pt-2.5" style={{ borderColor: 'var(--line, #efebe6)' }}>
              {email && <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={m.subject ? (/^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`) : 'Subject'} aria-label="Subject" className="h-10 w-full rounded-full border px-4 text-[14px]" style={{ borderColor: 'var(--line, #e7e2dc)' }} />}
              <textarea ref={boxRef} value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={`Write ${email ? 'an email' : app ? 'a' : 'a text'} reply${name ? ` to ${String(name).split(' ')[0]}` : ''}…`} aria-label="Reply" className="w-full rounded-2xl border p-3 text-[15px]" style={{ borderColor: 'var(--line, #e7e2dc)' }} />
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={reply} disabled={busy || !text.trim()} className="h-10 rounded-full px-5 text-[14px] font-semibold disabled:opacity-50" style={ink}>{busy ? 'Sending…' : 'Send reply'}</button>
                <span className="text-[12px]" style={muted}>{app ? 'Shows on their visit page. If they haven’t seen it in 10 minutes, it’s sent by text.' : `Sent from the business’s ${email ? 'email' : 'number'}.`}</span></div>
              {m.clientId && <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] font-semibold" style={muted}>Send their link:</span>
                {LINKS.map(([act, label]) => <button key={label} type="button" disabled={!!linkBusy} onMouseDown={(e) => e.preventDefault()} onClick={() => void insertLink(act)}
                  className="h-7 rounded-full px-3 text-[12px] font-semibold disabled:opacity-50" style={soft}>{linkBusy === act ? 'Getting link…' : label}</button>)}
              </div>}
            </div>
          </div>}
          {note && <p className="text-[13px]" style={note.ok ? okc : warn}>{note.t}</p>}
        </div>
      </div>
    </li>);
}

export default function InboxPage() {
  const { selectedTenant } = useTenant() as any; const tenantId: string = selectedTenant?.id || '';
  const [filter, setFilter] = React.useState<Filter>('unread'); const [items, setItems] = React.useState<any[] | null>(null);
  const [unread, setUnread] = React.useState(0); const [err, setErr] = React.useState<string | null>(null); const [open, setOpen] = React.useState<string | null>(null);
  // A message you've opened stays in view under "Unread" until you change the filter, so it doesn't vanish while you reply.
  const kept = React.useRef<Map<string, any>>(new Map());
  const load = React.useCallback(async () => {
    if (!tenantId) return;
    const r = await payPost('/api/inbox', { tenantId, action: 'list', filter });
    if (!r?.ok) { setErr(r?.error || 'We couldn’t load the inbox. Please try again.'); setItems((cur) => cur || []); return; }
    setErr(null); let list: any[] = r.items || [];
    if (filter === 'unread') { const ids = new Set(list.map((x) => x.id)); kept.current.forEach((x, id) => { if (!ids.has(id)) list.push(x); }); list = list.sort((a, b) => String(b.at).localeCompare(String(a.at))); }
    setItems(list); if (filter !== 'unknown') setUnread(filter === 'unread' ? r.unread : list.filter((x) => !x.readAt).length);
  }, [tenantId, filter]);
  React.useEffect(() => { kept.current.clear(); setItems(null); setOpen(null); void load(); const t = setInterval(() => void load(), 60000); return () => clearInterval(t); }, [load]);
  const toggle = (m: any) => {
    if (open === m.id) { setOpen(null); return; }
    setOpen(m.id);
    if (!m.readAt) {
      const read = { ...m, readAt: new Date().toISOString(), readBy: m.readBy || { name: 'you' } };
      if (filter === 'unread') kept.current.set(m.id, read);
      setItems((cur) => (cur || []).map((x) => (x.id === m.id ? read : x))); setUnread((n) => Math.max(0, n - 1));
      void payPost('/api/inbox', { tenantId, action: 'read', id: m.id }).then(() => load());
    }
  };
  return (
    <div className="min-h-full p-4 md:p-8"><AppHeader title="Inbox" />
      <div className="mx-auto mt-4 max-w-[820px] space-y-4">
        <div><h1 className="text-[28px] font-light tracking-[-0.02em]">Inbox{unread ? <span className="ml-2 align-middle text-[14px] font-semibold" style={muted}>{unread} unread</span> : null}</h1>
          <p className="text-[13.5px]" style={muted}>Replies to your texts and emails arrive here and are saved to the client’s record.</p></div>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Show">{FILTERS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className="h-9 rounded-full px-4 text-[13.5px] font-semibold" style={filter === k ? ink : soft}>{l}</button>)}</div>
        {err && <p className="text-[14px]" style={warn}>{err}</p>}
        {items === null ? <p className="text-[14px]" style={muted}>Loading…</p>
          : items.length === 0 ? <div className="rounded-3xl p-5" style={card}><p className="text-[14px]" style={muted}>{filter === 'unknown' ? 'Every message is linked to a client.' : 'Nothing new. Texts and emails from clients will appear here.'}</p></div>
          : <ul className="space-y-2.5">{items.map((m) => <InboxItem key={m.id} m={m} tenantId={tenantId} open={open === m.id} onToggle={() => toggle(m)} onChanged={() => void load()} />)}</ul>}
      </div>
    </div>);
}
