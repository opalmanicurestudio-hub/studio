'use client';
// src/components/orders/CustomerFlag.tsx — WHAT THE TEAM KNOWS ABOUT THIS CUSTOMER, WHERE THEY ANSWER THEM. A note kept
// by email (tenants/{t}/customerFlags): "watch" tells everyone who helps them what happened before, and "can't check out
// online" also stops their next online order (api/retail/checkout). Anyone on the team adds a note; only a manager stops
// online checkout or lets them back (the rules say the same). Notes are only ever added, never rewritten or taken away.
// Internal only: the customer never sees any of it, and reply drafts are told about it but never mention it. Shown on
// the order and in Problems.
import * as React from 'react';
import { arrayUnion, collection, doc, limit, onSnapshot, query, setDoc, updateDoc, where, type Firestore } from 'firebase/firestore';
import { Btn, C, Sheet, feel, muted } from './ui';

type Kind = 'fraud' | 'abuse' | 'chargeback' | 'other';
const KINDS: { id: Kind; label: string }[] = [{ id: 'fraud', label: 'Fraud' }, { id: 'abuse', label: 'Abusive' }, { id: 'chargeback', label: 'Chargeback' }, { id: 'other', label: 'Other' }];
const when = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };

/** The flag on this email, live: undefined while it's being read, null when there's none. A stop on any record for the
 *  email wins (the checkout reads them all). */
export function useCustomerFlag(fs: Firestore | null, tenantId: string, email: string): any | null | undefined {
  const [flag, setFlag] = React.useState<any | null | undefined>(undefined);
  const e = String(email || '').toLowerCase().trim();
  React.useEffect(() => {
    setFlag(undefined);
    if (!fs || !tenantId || !e) { setFlag(null); return; }
    return onSnapshot(query(collection(fs, `tenants/${tenantId}/customerFlags`), where('email', '==', e), limit(10)), (s) => {
      const rows = s.docs.map((d) => ({ ...(d.data() as any), id: d.id }));
      setFlag(rows.find((r) => r.level === 'banned') || rows[0] || null);
    }, () => setFlag(null));
  }, [fs, tenantId, e]);
  return flag;
}

export function CustomerFlag({ fs, tenantId, email, name, orderId, by, isManager, onToast }: { fs: Firestore; tenantId: string; email: string; name: string; orderId: string; by: string; isManager: boolean; onToast: (m: string) => void }) {
  const flag = useCustomerFlag(fs, tenantId, email);
  const [open, setOpen] = React.useState(false); const [kind, setKind] = React.useState<Kind>('other'); const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const e = String(email || '').toLowerCase().trim();
  const reasons: any[] = Array.isArray(flag?.reasons) ? flag.reasons : [];
  const latest = reasons[reasons.length - 1];
  const stopped = flag?.level === 'banned';
  const first = String(name || '').split(' ')[0] || 'them';
  const save = async (level: 'watch' | 'banned') => {
    if (!note.trim() || busy || !e || flag === undefined) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const reason = { at: now, by: String(by || 'Team').split(' ')[0], kind, note: note.trim().slice(0, 400), orderId };
      // Added to the list, never written over it (two notes at once both stay). A new one is kept under the email itself,
      // so two people flagging at once share one record.
      // The level is sent only when it changes, so a note never undoes a stop someone else has just made.
      if (flag?.id) await updateDoc(doc(fs, `tenants/${tenantId}/customerFlags`, flag.id), { ...(level !== (flag.level === 'banned' ? 'banned' : 'watch') ? { level } : {}), updatedAt: now, reasons: arrayUnion(reason) });
      else await setDoc(doc(fs, `tenants/${tenantId}/customerFlags`, e.replace(/\//g, '_')), { tenantId, email: e, name: name || '', level, reasons: arrayUnion(reason), createdAt: now, updatedAt: now }, { merge: true });
      feel(true); onToast(level === 'banned' ? `${first} can’t check out online now. Only the team sees this.` : `Noted. Only the team sees this.`);
      setOpen(false); setNote('');
    } catch { feel(false); onToast('That couldn’t be saved just now. Try again.'); } finally { setBusy(false); }
  };
  const lift = async () => {
    if (!flag?.id || busy) return;
    setBusy(true);
    try { await updateDoc(doc(fs, `tenants/${tenantId}/customerFlags`, flag.id), { level: 'watch', updatedAt: new Date().toISOString() }); feel(true); onToast(`${first} can check out online again. The notes stay.`); setOpen(false); }
    catch { feel(false); onToast('That couldn’t be saved just now. Try again.'); } finally { setBusy(false); }
  };
  if (!e) return null;
  return (
    <>
      {flag ? (
        <div className="mt-3 rounded-2xl px-4 py-3" style={{ background: C.warnSoft, color: C.warn }}>
          <p className="m-0 text-[15px] font-semibold">{stopped ? 'Can’t check out online' : 'Watch'}{latest?.kind ? ` · ${KINDS.find((k) => k.id === latest.kind)?.label || 'Other'}` : ''}</p>
          {latest?.note ? <p className="m-0 mt-0.5 text-[14px]" style={{ color: C.ink }}>{String(latest.note).slice(0, 300)}</p> : null}
          <p className="m-0 mt-1 text-[13px]" style={muted}>{latest ? `${latest.by || 'The team'}, ${when(latest.at)}` : ''}{reasons.length > 1 ? ` · ${reasons.length} notes` : ''} · only the team sees this</p>
          <button type="button" onClick={() => setOpen(true)} className="cf-press mt-1 h-11 text-[14px] font-semibold underline underline-offset-4" style={{ color: C.ink }}>Add a note</button>
        </div>
      ) : (
        <button type="button" disabled={flag === undefined} onClick={() => setOpen(true)} className="cf-press mt-1 h-11 text-[14px] font-semibold underline underline-offset-4 disabled:opacity-40" style={muted}>Flag this customer</button>
      )}
      {open && (
        <Sheet title={flag ? `A note about ${first}` : `Flag ${first}`} sub="Only the team sees this, wherever they help them next. The customer is never told." onClose={() => setOpen(false)}>
          {reasons.length > 0 && <ul className="m-0 mt-2 list-none space-y-2 p-0">{reasons.slice(-5).reverse().map((r, i) => <li key={i} className="rounded-2xl px-3.5 py-2.5 text-[14px]" style={{ background: C.soft }}><span className="font-semibold">{KINDS.find((k) => k.id === r.kind)?.label || 'Other'}</span> · {String(r.note || '').slice(0, 300)}<span className="block text-[12px]" style={muted}>{r.by || 'The team'}, {when(r.at)}</span></li>)}</ul>}
          <div role="group" aria-label="What happened" className="mt-3 flex flex-wrap gap-1.5">
            {KINDS.map((k) => <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)} className="cf-press h-11 rounded-full px-3.5 text-[14px] font-semibold" style={kind === k.id ? { background: C.ink, color: C.paper } : { background: C.soft, color: C.ink }}>{k.label}</button>)}
          </div>
          <label className="mt-3 block text-[13px] font-semibold" style={muted}>What happened
            <textarea value={note} onChange={(ev) => setNote(ev.target.value.slice(0, 400))} rows={3} placeholder="What the next person helping them should know" className="mt-1 block w-full resize-y rounded-2xl border px-4 py-3 text-[16px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} />
          </label>
          <Btn kind="primary" className="mt-4 w-full text-[17px]" disabled={busy || !note.trim()} onClick={() => void save(stopped ? 'banned' : 'watch')}>{busy ? 'Saving…' : stopped ? 'Add the note' : 'Save the note'}</Btn>
          {!stopped && isManager && <Btn kind="danger" className="mt-2 w-full" disabled={busy || !note.trim()} onClick={() => void save('banned')}>Save and stop online checkout</Btn>}
          {stopped && isManager && <Btn kind="soft" className="mt-2 w-full" disabled={busy} onClick={() => void lift()}>Let them check out online again</Btn>}
          {!isManager && <p className="m-0 mt-2 text-center text-[13px]" style={muted}>{stopped ? 'A manager can let them check out online again.' : 'If they shouldn’t order online, a manager can stop it.'}</p>}
        </Sheet>)}
    </>);
}
