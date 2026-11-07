'use client';
// src/components/consents/SignedFormRecord.tsx — ONE SIGNED FORM, READ BACK (on screen and printed). Each answer under
// its question (from the form as it reads now; a question no longer on the form keeps its own name), never the form
// screen's own marks; the signature as drawn, or the typed name marked as typed; who signed it and, for someone under
// 18, the parent or guardian who completed it and agreed; "I've read this" on a form with only wording; where and when
// it was signed. Plain words, no all-caps labels; prints in ink on white. Photos are private files (PrivateImg).
import * as React from 'react';
import { format } from 'date-fns';
import { fieldsOf, TYPED, toMs } from '@/lib/forms';
import { PrivateImg } from '@/components/shared/private-file';
import { wallDate } from '@/lib/tenant-time';

const MUTED = '#6d7075', LINE = '#ececee';
const where = (r: any) => r?.via === 'visit_link' || r?.source === 'visit_link' || r?.source === 'client_self_service' || r?.source === 'completion_link' ? 'on their visit link'
  : r?.source === 'online_booking' ? 'when they booked online' : r?.source === 'desk_booking' ? 'when the team booked it'
  : /kiosk|walk/.test(String(r?.source || '')) ? 'at the check-in screen' : '';
const human = (k: string) => k.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
/** An answer in words, whatever shape it was saved in (a list, yes or no, a date, a small set of choices). */
const said = (v: any): string => {
  if (v === undefined || v === null || v === '') return '';
  if (Array.isArray(v)) return v.map(said).filter(Boolean).join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') { if (typeof v.toDate === 'function') { try { return format(v.toDate(), 'MMM d, yyyy'); } catch { return ''; } }
    return Object.entries(v).filter(([, x]) => x !== false && x !== null && x !== '' && x !== undefined).map(([k, x]) => (x === true ? human(k) : `${human(k)}: ${said(x)}`)).join(', '); }
  return String(v);
};
/** When, on the business's clock if it has one. */
const when = (ms: number, zone: string | null | undefined, f: string) => format(zone ? wallDate(new Date(ms), zone) : new Date(ms), f);

export function Signature({ v }: { v: any }) {
  if (typeof v === 'string' && v.startsWith(TYPED)) return <p className="text-[19px] italic" style={{ fontFamily: 'Georgia, serif' }}>{v.slice(TYPED.length)} <span className="text-[12px] not-italic" style={{ color: MUTED, fontFamily: 'inherit' }}>(typed)</span></p>;
  if (typeof v === 'string' && v.startsWith('data:image')) return <img src={v} alt="Signature" className="h-16 max-w-[240px] object-contain" style={{ background: '#fff' }} />;
  // A signature kept as a private file opens through its signed link.
  if (typeof v === 'string' && /^(https:|\/api\/files\/view\?)/.test(v)) return <PrivateImg src={v} alt="Signature" className="h-16 max-w-[240px] object-contain" />;
  return <p style={{ color: MUTED }}>Not signed</p>;
}

export function SignedFormRecord({ record, form, compact, zone }: { record: any; form?: any | null; compact?: boolean; zone?: string | null }) {
  const data: Record<string, any> = record?.formData && typeof record.formData === 'object' ? record.formData : {};
  const known = form ? fieldsOf(form) : [];
  const fromForm = known.filter((f: any) => f.type !== 'heading' && f.type !== 'paragraph');
  // Answers to questions no longer on the form keep their own name; the form screen's own marks are never shown.
  const extra = Object.keys(data).filter((k) => !/^__(signedName|read|seen)$/.test(k) && !/^__.*__$/.test(k) && !known.some((f: any) => f.id === k));
  // An answer whose question is gone: a drawn or typed signature, a private photo, or words.
  const kindOf = (v: any) => (/^data:image|^typed:/.test(String(v || '')) ? 'signature' : (Array.isArray(v) ? v : [v]).some((x) => /^\/api\/files\/view\?/.test(String(x || ''))) ? 'image-upload' : 'text');
  const questions = [...fromForm, ...extra.map((k) => ({ id: k, type: kindOf(data[k]), label: human(k) }))];
  // Answers moved beside the visit and none here: say where they are, never a list of "No answer".
  const moved = !!record?.answersMoved && !Object.keys(data).some((k) => !/^__/.test(k));
  const sigs = questions.filter((q: any) => q.type === 'signature'); const rest = questions.filter((q: any) => q.type !== 'signature');
  const at = toMs(record?.signedAt);
  const guardian = record?.guardian?.name ? record.guardian : record?.guardianName ? { name: record.guardianName, relationship: record.guardianRelationship } : null;
  return (
    <div className={compact ? 'space-y-3 text-[13.5px]' : 'space-y-4 text-[14px]'} style={{ color: '#16171a' }}>
      {record?.answersMoved && <p style={{ color: MUTED }}>The answers to this form are kept beside the visit it was signed for.</p>}
      {rest.length > 0 && !moved && <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {rest.map((q: any) => { const v = data[q.id];
          return (<div key={q.id} className="break-inside-avoid"><p className="text-[12.5px] font-medium" style={{ color: MUTED }}>{q.label || 'Question'}</p>
            {q.type === 'image-upload' && (Array.isArray(v) ? v.length > 0 : typeof v === 'string' && !!v)
              ? <div className="mt-1 flex flex-wrap gap-2">{(Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string' && x).slice(0, 8).map((x: string, k: number) => <PrivateImg key={k} src={x} alt={`${q.label || 'Photo'}${Array.isArray(v) && v.length > 1 ? ` ${k + 1}` : ''}`} className="h-24 w-24 rounded-lg object-cover" />)}</div>
              : <p className="whitespace-pre-wrap">{said(v) || <span style={{ color: MUTED }}>No answer</span>}</p>}</div>); })}
      </div>}
      {record?.acknowledged && <p>They ticked “I’ve read this”.</p>}
      {(sigs.length > 0 || record?.signedName || guardian) && <div className="space-y-2 pt-3 break-inside-avoid" style={{ borderTop: `1px solid ${LINE}` }}>
        {!moved && sigs.map((q: any) => <Signature key={q.id} v={data[q.id]} />)}
        {record?.signedName && <p>Signed as {record.signedName}</p>}
        {guardian && <p>Completed by {guardian.name}{guardian.relationship ? ` (${guardian.relationship})` : ''}, who agreed to it as their parent or legal guardian</p>}
      </div>}
      {at > 0 && <p className="text-[12.5px]" style={{ color: MUTED }}>Signed {where(record) ? `${where(record)}, ` : ''}{when(at, zone, 'MMMM d, yyyy, h:mm a')}</p>}
    </div>);
}

/** A signed form in a list (the client's profile): its title, when and where it was signed, any guardian, and its
 *  answers one tap away (onOpen: say who looked, for health answers). */
export function SignedFormRow({ sc, form, first, onOpen, locked, zone }: { sc: any; form?: any | null; first?: boolean; onOpen?: () => void; locked?: boolean; zone?: string | null }) {
  const [open, setOpen] = React.useState(false);
  const at = toMs(sc?.signedAt);
  return (
    <div className="px-4 py-3.5" style={first ? undefined : { borderTop: `1px solid ${LINE}` }}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15.5px]">{sc?.formTitle || form?.title || 'Form'}</p>
          <p className="text-[13px]" style={{ color: MUTED }}>{at ? `Signed ${when(at, zone, 'MMM d, yyyy')}` : 'Signed'}{where(sc) ? ` · ${where(sc)}` : ''}{sc?.guardianName ? ` · by ${sc.guardianName}, ${sc.guardianRelationship || 'parent or guardian'}` : ''}</p>
        </div>
        {locked ? <span className="text-[13px]" style={{ color: MUTED }}>Health answers are private</span>
          : <button type="button" aria-expanded={open} onClick={() => { const next = !open; setOpen(next); if (next) onOpen?.(); }} className="min-h-11 min-w-11 px-1 text-[14px] font-semibold">{open ? 'Hide answers' : 'See answers'}</button>}
      </div>
      {open && !locked && <div className="mt-3 rounded-2xl p-4" style={{ background: '#f5f5f7' }}><SignedFormRecord record={sc} form={form || null} zone={zone} compact /></div>}
    </div>);
}
