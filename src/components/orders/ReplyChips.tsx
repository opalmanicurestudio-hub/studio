'use client';
// src/components/orders/ReplyChips.tsx — READY REPLIES IN A REPLY BOX (lib/replies, mockups 10A, 10B, 10E). One tap puts
// the business's wording in the box, filled in from the order; the person reads it, changes what they like and sends.
// A detail the order doesn't have stays as [label] and is pointed out before it goes.
import * as React from 'react';
import Link from 'next/link';
import { collection, onSnapshot, type Firestore } from 'firebase/firestore';
import { useTenant } from '@/context/TenantContext';
import { fillReply, hasGap, repliesFor, REPLY_TOKENS, type ReplyContext, type ReplySituation } from '@/lib/replies';
import { C } from './ui';

/** The business's own replies, live: null until they've loaded and false if they can't be read, so nobody picks the
 *  built-in wording of a reply the business changed or hid. */
export function useStoredReplies(fs: Firestore | null | undefined, tenantId: string) {
  const [stored, setStored] = React.useState<any[] | null | false>(null);
  React.useEffect(() => {
    if (!fs || !tenantId) { setStored(null); return; }
    setStored(null);
    return onSnapshot(collection(fs, `tenants/${tenantId}/replies`), (s: any) => setStored(s.docs.map((d: any) => ({ ...(d.data() || {}), id: d.id }))), () => setStored(false));
  }, [fs, tenantId]);
  return stored;
}

/** What a reply can fill in from a shop order. */
export function replyContext(order: any, shop: string, extra: ReplyContext = {}): ReplyContext {
  const lines = (Array.isArray(order?.lines) ? order.lines : []).filter((l: any) => l && l.name);
  return {
    client_first: String(order?.customerName || '').trim().split(/\s+/)[0] || '',
    order_number: order?.orderNumber != null ? String(order.orderNumber).padStart(4, '0') : '',
    item: lines.length === 1 ? String(lines[0].name) : '',
    studio: shop,
    ...extra,
  };
}

/** A picked reply into the box: it replaces an earlier pick nobody changed, and goes after anything they wrote (on a
 *  new paragraph, or after a space in a one-line box). */
export function pickInto(current: string, lastFill: string | null, next: string, sep = '\n\n'): string {
  const cur = String(current || '').trim();
  if (!cur || (lastFill !== null && cur === lastFill.trim())) return next;
  return `${cur}${sep}${next}`;
}

export function ReplyChips({ fs, tenantId, situation, ctx, picked, onPick, className = '' }: {
  fs: Firestore | null | undefined; tenantId: string; situation: ReplySituation; ctx: ReplyContext; picked?: string | null;
  onPick: (text: string, id: string) => void; className?: string;
}) {
  const t: any = useTenant();
  const canEdit = typeof t?.can === 'function' ? !!t.can('settings.manage') : false;
  const shop = String(t?.selectedTenant?.businessName || t?.selectedTenant?.name || '');
  const stored = useStoredReplies(fs, tenantId);
  if (!Array.isArray(stored)) return null;
  const list = repliesFor(stored, situation);
  if (!list.length && !canEdit) return null;
  return (
    <div role="group" aria-label="Ready replies" className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {list.map((r) => (
        <button key={r.id} type="button" aria-pressed={picked === r.id} onClick={() => onPick(fillReply(r.text, { ...ctx, studio: ctx.studio || shop }), r.id)}
          className="cf-press h-9 rounded-full px-3 text-[13px] font-semibold" style={picked === r.id ? { border: `2px solid ${C.ink}`, padding: '0 11px', background: C.paper, color: C.ink } : { border: `1px solid ${C.line}`, background: C.paper, color: C.ink }}>{r.name}</button>))}
      {canEdit && <Link href="/settings/replies" className="ml-1 inline-flex h-9 items-center text-[13px] font-semibold underline underline-offset-[3px]" style={{ color: C.ink }}>{list.length ? 'Edit replies' : 'Add ready replies'}</Link>}
    </div>);
}

/** Under the box: a detail still to fill in, by name. Always there, so a screen reader hears it when it appears. */
export function GapNote({ text }: { text: string }) {
  const left = hasGap(text) ? REPLY_TOKENS.filter((x) => text.includes(`[${x.label}]`)).map((x) => x.label) : [];
  return <p role="status" aria-live="polite" className={left.length ? 'm-0 mt-1.5 text-[13px]' : 'sr-only'} style={left.length ? { color: C.warn } : undefined}>{left.length ? `Fill in the ${left.join(' and ')} before sending.` : ''}</p>;
}
