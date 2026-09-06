'use client';

// src/components/renters/RenterCommsDesk.tsx
//
// Three things an owner needs to answer from one place, before opening any
// renter's card:
//   1. Who is waiting on me?      — unread replies, oldest first
//   2. What has the floor raised? — concerns, with a status and a reference
//   3. Tell everyone something    — one message, each renter gets their own copy
//
// Nothing here is a second messaging system. Every word goes out through the
// same 'renter-message' / 'renter-broadcast' / 'concern-respond' doors, so it
// lands in the renter's thread with delivery status, in the timeline, and on
// the account record. This is a desk in front of the thread, not beside it.

import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GRIEVANCE_CATEGORY_LABEL, GRIEVANCE_STATUS_LABEL, isOpenGrievance } from '@/lib/grievances';
import { RENTER_DOC_TEMPLATES, RENTER_DOC_FIELDS, renterDocVars, renderRenterDoc, unfilledPlaceholders, type RenterDocKind } from '@/lib/renter-documents';

const ago = (iso: string) => {
  const ms = Date.now() - new Date(iso || 0).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
};

export function RenterCommsDesk({ tenantId, firestore, tenant, renters, booths, leases, studioName, onOpenRenter }: {
  tenantId: string; firestore: any; tenant?: any; renters: any[]; booths: any[]; leases: any[]; studioName: string; onOpenRenter: (renterId: string) => void;
}) {
  const [threads, setThreads] = useState<any[]>([]);
  const [concerns, setConcerns] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [tab, setTab] = useState<'inbox' | 'concerns' | 'everyone' | 'documents'>('inbox');
  const [docRenter, setDocRenter] = useState('');
  const [docKind, setDocKind] = useState<RenterDocKind | ''>('');
  const [docFields, setDocFields] = useState<Record<string, string>>({});
  const [docBody, setDocBody] = useState('');
  const [docTouched, setDocTouched] = useState(false);
  const [docSent, setDocSent] = useState('');
  const [busy, setBusy] = useState('');
  const [reply, setReply] = useState<Record<string, string>>({});
  const [bText, setBText] = useState('');
  const [audience, setAudience] = useState<'active' | 'all' | 'picked'>('active');
  const [picked, setPicked] = useState<string[]>([]);
  const [sendArm, setSendArm] = useState(false);
  const [lastSend, setLastSend] = useState<string>('');
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (!firestore || !tenantId) return;
    const u1 = onSnapshot(collection(firestore, 'tenants', tenantId, 'renterThreads'), (s) => setThreads(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => setThreads([]));
    const u2 = onSnapshot(collection(firestore, 'tenants', tenantId, 'renterGrievances'), (s) => setConcerns(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => setConcerns([]));
    const u3 = onSnapshot(collection(firestore, 'tenants', tenantId, 'renterDocuments'), (s) => setDocs(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => setDocs([]));
    return () => { u1(); u2(); u3(); };
  }, [firestore, tenantId]);
  useEffect(() => { if (!sendArm) return; const t = setTimeout(() => setSendArm(false), 6000); return () => clearTimeout(t); }, [sendArm]);

  const renterById = useMemo(() => new Map(renters.map((r) => [r.id, r])), [renters]);
  const nameOf = (id: string) => { const r = renterById.get(id); return r ? `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'Renter' : 'Renter'; };
  const boothNameOf = (renterId: string) => {
    const l = leases.find((x) => x.renterId === renterId && ['active', 'on_leave'].includes(String(x.status)));
    return (l && booths.find((b) => b.id === l.boothId)?.name) || '';
  };
  const unread = useMemo(() => threads.filter((t) => t.unreadForOwner && renterById.has(t.renterId || t.id)).sort((a, b) => String(a.lastAt).localeCompare(String(b.lastAt))), [threads, renterById]);
  const openConcerns = useMemo(() => concerns.filter(isOpenGrievance).sort((a, b) => String(a.filedAt).localeCompare(String(b.filedAt))), [concerns]);
  const doneConcerns = useMemo(() => concerns.filter((c) => !isOpenGrievance(c)).sort((a, b) => String(b.resolvedAt || b.filedAt).localeCompare(String(a.resolvedAt || a.filedAt))), [concerns]);
  const activeRenters = useMemo(() => renters.filter((r) => String(r.status) === 'active'), [renters]);
  const allRenters = useMemo(() => renters.filter((r) => ['active', 'on_leave', 'maternity_leave', 'pending'].includes(String(r.status))), [renters]);
  const audienceCount = audience === 'active' ? activeRenters.length : audience === 'all' ? allRenters.length : picked.length;

  const markRead = async (renterId: string) => {
    if (!firestore) return;
    await setDoc(doc(firestore, 'tenants', tenantId, 'renterThreads', renterId), { unreadForOwner: false, ownerSeenAt: new Date().toISOString() }, { merge: true }).catch(() => null);
  };
  const respond = async (g: any, status: 'acknowledged' | 'resolved' | null) => {
    const text = (reply[g.id] || '').trim();
    if (!text && !status) return;
    setBusy(g.id);
    try {
      const res = await fetch('/api/booths/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'concern-respond', tenantId, grievanceId: g.id, text, status, byName: studioName }) });
      if (res.ok) setReply((m) => ({ ...m, [g.id]: '' }));
    } finally { setBusy(''); }
  };
  const broadcast = async () => {
    const text = bText.trim();
    if (!text || audienceCount === 0) return;
    setBusy('broadcast');
    try {
      const res = await fetch('/api/booths/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'renter-broadcast', tenantId, text, byName: studioName, audience, renterIds: audience === 'picked' ? picked : [] }) });
      const d = await res.json().catch(() => ({}));
      if (d?.ok) { setLastSend(`Sent to ${d.recipients} renter${d.recipients === 1 ? '' : 's'} · ${d.emailed} emailed · ${d.texted} texted`); setBText(''); setPicked([]); }
      else setLastSend(d?.error || 'Could not send.');
    } finally { setBusy(''); setSendArm(false); }
  };

  // ── Documents: pick a renter and a template, fill the blanks, read the
  // rendered text, send. The body is frozen at send; the renter signs THAT.
  const docLease = useMemo(() => leases.find((l) => l.renterId === docRenter && ['active', 'on_leave'].includes(String(l.status))) || null, [leases, docRenter]);
  const docPreview = useMemo(() => {
    if (!docRenter || !docKind) return null;
    const renter = renterById.get(docRenter);
    const booth = docLease ? booths.find((b) => b.id === docLease.boothId) : null;
    const vars = renterDocVars({ tenant, renter, lease: docLease, booth });
    return renderRenterDoc(docKind, vars, docFields);
  }, [docRenter, docKind, docFields, docLease, renterById, booths, tenant]);
  useEffect(() => { if (docPreview && !docTouched) setDocBody(docPreview.body); }, [docPreview, docTouched]);
  const pendingDocs = useMemo(() => docs.filter((d) => d.status === 'sent').sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt))), [docs]);
  const doneDocs = useMemo(() => docs.filter((d) => d.status !== 'sent').sort((a, b) => String(b.signedAt || b.declinedAt || b.sentAt).localeCompare(String(a.signedAt || a.declinedAt || a.sentAt))).slice(0, 12), [docs]);
  const docBlanks = unfilledPlaceholders(docBody);
  const sendDoc = async () => {
    if (!firestore || !docRenter || !docKind || !docPreview || docBlanks.length > 0) return;
    setBusy('doc');
    try {
      const nowIso = new Date().toISOString();
      const t = RENTER_DOC_TEMPLATES[docKind];
      const meta: Record<string, any> = {};
      if (docKind === 'renewal_offer') {
        const cents = Math.round((Number(docFields.newRentAmount) || 0) * 100);
        if (cents > 0) meta.newRentCents = cents;
        if (docFields.newEndDate) meta.newEndDate = docFields.newEndDate;
        if (docFields.renewalStart) meta.renewalStart = docFields.renewalStart;
      }
      const ref = doc(collection(firestore, 'tenants', tenantId, 'renterDocuments'));
      await setDoc(ref, {
        id: ref.id, renterId: docRenter, renterName: nameOf(docRenter), leaseId: docLease?.id || null,
        kind: docKind, title: docPreview.title, body: docBody.trim(), action: t.action, status: 'sent',
        sentAt: nowIso, sentBy: studioName, meta,
      });
      await fetch('/api/booths/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'renter-message', tenantId, renterId: docRenter, byName: studioName,
          text: `${t.action === 'sign' ? 'A document to sign' : 'A document to read and acknowledge'}: "${docPreview.title}". Open your portal → Documents.` }) }).catch(() => null);
      setDocSent(`Sent "${docPreview.title}" to ${nameOf(docRenter)}.`);
      setDocKind(''); setDocFields({}); setDocBody(''); setDocTouched(false);
    } finally { setBusy(''); }
  };
  const withdrawDoc = async (d: any) => {
    if (!firestore) return;
    await setDoc(doc(firestore, 'tenants', tenantId, 'renterDocuments', d.id), { status: 'withdrawn', withdrawnAt: new Date().toISOString() }, { merge: true }).catch(() => null);
  };

  const Tab = ({ k, label, count, tone }: { k: typeof tab; label: string; count?: number; tone?: string }) => (
    <button type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
      className={cn('h-10 rounded-xl border-2 px-3.5 text-[11px] font-black transition-all flex items-center gap-2', tab === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200')}>
      {label}
      {count !== undefined && count > 0 && <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-black', tab === k ? 'bg-white text-slate-900' : tone || 'bg-slate-900 text-white')}>{count}</span>}
    </button>
  );

  return (
    <section className="rounded-[2rem] border-2 bg-white p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Tab k="inbox" label="Waiting on you" count={unread.length} tone="bg-amber-500 text-white" />
        <Tab k="concerns" label="Concerns" count={openConcerns.length} tone="bg-red-600 text-white" />
        <Tab k="everyone" label="Message everyone" />
        <Tab k="documents" label="Documents" count={pendingDocs.length} tone="bg-slate-500 text-white" />
      </div>

      {tab === 'inbox' && (
        <div className="space-y-1.5">
          {unread.length === 0 && <p className="text-[11px] font-bold text-muted-foreground">Nobody is waiting on a reply. Open any renter's card to write to them.</p>}
          {unread.map((t) => {
            const id = t.renterId || t.id;
            return (
              <button key={t.id} type="button" onClick={() => { void markRead(id); onOpenRenter(id); }}
                className="w-full rounded-2xl border-2 border-amber-300 bg-amber-50 px-3.5 py-2.5 text-left hover:bg-amber-100 transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-black truncate">{nameOf(id)}{boothNameOf(id) ? <span className="font-bold text-slate-500"> · {boothNameOf(id)}</span> : null}</p>
                  <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-amber-800">{ago(t.lastAt)}</span>
                </div>
                <p className="text-[11px] font-medium text-slate-700 truncate">{t.lastText || 'New message'}</p>
              </button>
            );
          })}
        </div>
      )}

      {tab === 'concerns' && (
        <div className="space-y-2">
          {openConcerns.length === 0 && <p className="text-[11px] font-bold text-muted-foreground">No open concerns. Renters raise them from their portal; each gets a reference and a receipt.</p>}
          {openConcerns.map((g) => (
            <div key={g.id} className={cn('rounded-2xl border-2 px-3.5 py-3 space-y-2', g.status === 'open' ? 'border-red-300 bg-red-50/60' : 'border-slate-200 bg-slate-50')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-black">
                    <button type="button" onClick={() => onOpenRenter(g.renterId)} className="underline decoration-2 underline-offset-2">{g.renterName || nameOf(g.renterId)}</button>
                    <span className="font-bold text-slate-500"> · {g.ref} · {GRIEVANCE_CATEGORY_LABEL[g.category as keyof typeof GRIEVANCE_CATEGORY_LABEL] || g.category}</span>
                    {g.confidential && <span className="ml-1.5 rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white">confidential</span>}
                  </p>
                  <p className="text-[10px] font-bold text-slate-500">Filed {ago(g.filedAt)} · about {g.when} · {GRIEVANCE_STATUS_LABEL[g.status as keyof typeof GRIEVANCE_STATUS_LABEL]}</p>
                </div>
              </div>
              <p className="text-[12px] font-medium text-slate-800 whitespace-pre-wrap">{g.what}</p>
              {g.wanted && <p className="text-[11px] font-bold text-slate-600">What they'd like: <span className="font-medium">{g.wanted}</span></p>}
              <textarea value={reply[g.id] || ''} onChange={(e) => setReply((m) => ({ ...m, [g.id]: e.target.value }))} rows={2}
                aria-label={`Reply to ${g.ref}`} placeholder="Your reply goes to their portal, email and phone, with the reference on it."
                className="w-full rounded-xl border-2 bg-white px-3 py-2 text-sm" />
              <div className="flex flex-wrap gap-2">
                {g.status === 'open' && <Button variant="outline" onClick={() => respond(g, 'acknowledged')} disabled={busy === g.id} className="h-9 rounded-lg border-2 font-black uppercase text-[9px] tracking-widest">Acknowledge{(reply[g.id] || '').trim() ? ' + reply' : ''}</Button>}
                <Button onClick={() => respond(g, null)} disabled={busy === g.id || !(reply[g.id] || '').trim()} className="h-9 rounded-lg font-black uppercase text-[9px] tracking-widest">Reply</Button>
                <Button onClick={() => respond(g, 'resolved')} disabled={busy === g.id} className="h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 font-black uppercase text-[9px] tracking-widest">Resolve{(reply[g.id] || '').trim() ? ' with note' : ''}</Button>
              </div>
            </div>
          ))}
          {doneConcerns.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="text-[9px] font-black uppercase tracking-widest text-slate-500">{showDone ? 'Hide' : 'Show'} {doneConcerns.length} resolved</button>
              {showDone && doneConcerns.map((g) => (
                <div key={g.id} className="mt-1.5 rounded-xl border-2 bg-white px-3 py-2">
                  <p className="text-[11px] font-black">{g.renterName || nameOf(g.renterId)}<span className="font-bold text-slate-500"> · {g.ref} · {GRIEVANCE_CATEGORY_LABEL[g.category as keyof typeof GRIEVANCE_CATEGORY_LABEL] || g.category} · {GRIEVANCE_STATUS_LABEL[g.status as keyof typeof GRIEVANCE_STATUS_LABEL]} {String(g.resolvedAt || '').slice(0, 10)}</span></p>
                  {g.resolution && <p className="text-[11px] font-medium text-slate-600">{g.resolution}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'documents' && (
        <div className="space-y-3">
          <div className="rounded-2xl border-2 bg-slate-50 px-3.5 py-3 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Send a document</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select value={docRenter} onChange={(e) => { setDocRenter(e.target.value); setDocTouched(false); }} aria-label="Renter" className="h-10 rounded-xl border-2 bg-white px-3 text-sm font-bold">
                <option value="">Who is it for?</option>
                {allRenters.map((r) => <option key={r.id} value={r.id}>{`${r.firstName || ''} ${r.lastName || ''}`.trim()}{boothNameOf(r.id) ? ` · ${boothNameOf(r.id)}` : ''}</option>)}
              </select>
              <select value={docKind} onChange={(e) => { setDocKind(e.target.value as RenterDocKind); setDocFields({}); setDocTouched(false); setDocSent(''); }} aria-label="Document" className="h-10 rounded-xl border-2 bg-white px-3 text-sm font-bold" disabled={!docRenter}>
                <option value="">Which document?</option>
                {(Object.keys(RENTER_DOC_TEMPLATES) as RenterDocKind[]).map((k) => <option key={k} value={k}>{RENTER_DOC_TEMPLATES[k].title}</option>)}
              </select>
            </div>
            {docKind && <p className="text-[10px] font-bold text-slate-500">{RENTER_DOC_TEMPLATES[docKind].blurb}{docRenter && !docLease ? ' No active lease found for this renter — numbers will show as blanks.' : ''}</p>}
            {docKind && RENTER_DOC_FIELDS[docKind].length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {RENTER_DOC_FIELDS[docKind].map((f) => f.multiline ? (
                  <textarea key={f.key} value={docFields[f.key] || ''} onChange={(e) => { setDocFields((m) => ({ ...m, [f.key]: e.target.value })); setDocTouched(false); }} rows={2} aria-label={f.label} placeholder={`${f.label} — ${f.placeholder}`} className="sm:col-span-2 rounded-xl border-2 bg-white px-3 py-2 text-sm" />
                ) : (
                  <input key={f.key} type={f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'money' ? 'decimal' : undefined} value={docFields[f.key] || ''} onChange={(e) => { setDocFields((m) => ({ ...m, [f.key]: e.target.value })); setDocTouched(false); }} aria-label={f.label} placeholder={`${f.label}${f.placeholder ? ` — ${f.placeholder}` : ''}`} className="h-10 rounded-xl border-2 bg-white px-3 text-sm font-bold" />
                ))}
              </div>
            )}
            {docPreview && (
              <div className="space-y-1.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{docPreview.title} · what they will {RENTER_DOC_TEMPLATES[docKind as RenterDocKind].action} — edit freely</p>
                <textarea value={docBody} onChange={(e) => { setDocBody(e.target.value); setDocTouched(true); }} rows={12} aria-label="Document text" className="w-full rounded-xl border-2 bg-white px-3 py-2 text-[12px] leading-relaxed font-medium" />
                {docBlanks.length > 0 && <p className="text-[10px] font-black text-red-700">Still blank: {docBlanks.join(', ')} — fill them above or edit them out of the text.</p>}
                <div className="flex items-center gap-2">
                  <Button onClick={sendDoc} disabled={busy === 'doc' || docBlanks.length > 0 || !docBody.trim()} className="h-10 flex-1 rounded-xl font-black uppercase text-[10px] tracking-widest">{busy === 'doc' ? 'Sending…' : `Send for ${RENTER_DOC_TEMPLATES[docKind as RenterDocKind].action === 'sign' ? 'signature' : 'acknowledgment'}`}</Button>
                  {docTouched && <button type="button" onClick={() => { setDocTouched(false); if (docPreview) setDocBody(docPreview.body); }} className="h-10 rounded-xl border-2 bg-white px-3 text-[9px] font-black uppercase tracking-widest text-slate-600">Reset text</button>}
                </div>
                <p className="text-[9px] font-bold text-slate-400">The text is frozen when you send. Templates are starting points, not legal advice — the words you send are the words they sign.</p>
              </div>
            )}
            {docSent && <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">{docSent}</p>}
          </div>
          {pendingDocs.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-amber-800">Waiting on them</p>
              {pendingDocs.map((d) => (
                <div key={d.id} className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-3.5 py-2.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-black truncate"><button type="button" onClick={() => onOpenRenter(d.renterId)} className="underline decoration-2 underline-offset-2">{d.renterName}</button><span className="font-bold text-slate-500"> · {d.title} · sent {ago(d.sentAt)}</span></p>
                  <div className="flex shrink-0 gap-1.5">
                    <a href={`/api/booths/renter-document?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(d.id)}`} target="_blank" rel="noopener" className="h-8 inline-flex items-center rounded-lg border-2 bg-white px-2.5 text-[9px] font-black uppercase tracking-widest text-slate-700">View</a>
                    <button type="button" onClick={() => withdrawDoc(d)} className="h-8 rounded-lg border-2 border-red-200 bg-white px-2.5 text-[9px] font-black uppercase tracking-widest text-red-700">Withdraw</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {doneDocs.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Recent</p>
              {doneDocs.map((d) => (
                <p key={d.id} className="text-[10px] font-bold text-slate-600 flex items-center justify-between gap-2">
                  <span className="truncate">{d.renterName} · {d.title} · <span className={cn('font-black', d.status === 'signed' ? 'text-emerald-700' : d.status === 'declined' ? 'text-red-700' : 'text-slate-500')}>{d.status}</span>{d.signedName ? ` as ${d.signedName}` : ''}{d.declineNote ? ` — “${d.declineNote}”` : ''}</span>
                  <a href={`/api/booths/renter-document?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(d.id)}`} target="_blank" rel="noopener" className="shrink-0 text-[9px] font-black uppercase tracking-widest underline">Print</a>
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'everyone' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {([['active', `Everyone renting now · ${activeRenters.length}`], ['all', `Including on leave · ${allRenters.length}`], ['picked', `Pick renters${picked.length ? ` · ${picked.length}` : ''}`]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setAudience(k)} aria-pressed={audience === k}
                className={cn('h-9 rounded-full border-2 px-3 text-[10px] font-black uppercase tracking-widest', audience === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600')}>{label}</button>
            ))}
          </div>
          {audience === 'picked' && (
            <div className="flex flex-wrap gap-1.5">
              {allRenters.map((r) => { const on = picked.includes(r.id); return (
                <button key={r.id} type="button" aria-pressed={on} onClick={() => setPicked((p) => on ? p.filter((x) => x !== r.id) : [...p, r.id])}
                  className={cn('h-8 rounded-full border-2 px-2.5 text-[10px] font-black', on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600')}>{`${r.firstName || ''} ${r.lastName || ''}`.trim()}</button>
              ); })}
            </div>
          )}
          <textarea value={bText} onChange={(e) => setBText(e.target.value.slice(0, 2000))} rows={4} aria-label="Message to every renter"
            placeholder="Water is off Tuesday 9–11 while the plumber replaces the main. Plan clients around it — sorry for the hassle."
            className="w-full rounded-xl border-2 bg-white px-3 py-2 text-sm" />
          <p className="text-[10px] font-bold text-slate-500">Each renter gets their own copy — email, text and their portal thread — with delivery status on their card. Nobody sees anyone else's address. Replies come only to you.</p>
          <div className="flex items-center gap-2">
            <Button onClick={() => { if (sendArm) void broadcast(); else setSendArm(true); }} disabled={busy === 'broadcast' || !bText.trim() || audienceCount === 0}
              className={cn('h-10 flex-1 rounded-xl font-black uppercase text-[10px] tracking-widest', sendArm && 'bg-red-700 hover:bg-red-800')}>
              {busy === 'broadcast' ? 'Sending…' : sendArm ? `Tap again · send to ${audienceCount}` : `Send to ${audienceCount} renter${audienceCount === 1 ? '' : 's'}`}
            </Button>
          </div>
          {lastSend && <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">{lastSend}</p>}
        </div>
      )}
    </section>
  );
}
