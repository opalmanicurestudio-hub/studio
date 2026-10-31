'use client';
// src/components/settings/RepliesScreen.tsx — THE REPLIES PLAYBOOK (mockup 10G, lib/replies). What sends on its own (the
// shop's acknowledgments and updates, worded in Client messages) and the ready replies the team picks in a reply box.
// Changed through /api/replies by the people whose role runs the settings; everyone else can read it.
import * as React from 'react';
import Link from 'next/link';
import { useFirebase } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { staffAuthHeader } from '@/lib/staff-fetch';
import { MESSAGE_KIND_BY_ID, resolveMessagePolicy } from '@/lib/message-policy';
import { AUTOMATIC_KINDS, SITUATIONS, playbook, tokensFor, readable, BUILT_IN_REPLIES, type Reply, type ReplySituation } from '@/lib/replies';
import { useStoredReplies } from '@/components/orders/ReplyChips';
import { Btn, C, LargeTitle, Toggle, muted } from '@/components/orders/ui';

const box: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 18, background: C.paper };
const linkCls = 'font-semibold underline underline-offset-[3px]';
// The shop messages' own details, by name.
// The link becomes a button in the email, so it isn't shown in the words.
const NAMES: Record<string, string> = { client_first: 'first name', order_number: 'order number', item: 'item', amount: 'amount', studio: 'shop name', case_ref: 'case number', reason: 'reason' };
const plain = (t: string) => String(t || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => (NAMES[String(k).toLowerCase()] ? `[${NAMES[String(k).toLowerCase()]}]` : '')).replace(/\s+/g, ' ').trim();

async function post(body: any) {
  try {
    const r = await fetch('/api/replies', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await staffAuthHeader()) }, body: JSON.stringify(body) });
    return await r.json().catch(() => ({ ok: false, error: 'That didn’t save. Try again.' }));
  } catch { return { ok: false, error: 'No connection. Try again.' }; }
}

type Draft = { id: string | null; situation: ReplySituation; name: string; text: string };

export function RepliesScreen() {
  const { firestore } = useFirebase();
  const t: any = useTenant();
  const tenant: any = t.selectedTenant;
  const tenantId = String(tenant?.id || '');
  const canEdit = typeof t.can === 'function' ? !!t.can('settings.manage') : false;
  const stored = useStoredReplies(firestore as any, tenantId);
  const all = React.useMemo(() => playbook(Array.isArray(stored) ? stored : [], { withHidden: true }), [stored]);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState('');
  const [said, setSaid] = React.useState<{ text: string; bad?: boolean } | null>(null);
  const textRef = React.useRef<HTMLTextAreaElement | null>(null);
  const editorRef = React.useRef<HTMLDivElement | null>(null);
  const returnTo = React.useRef<string | null>(null);

  const open = (d: Draft, from?: string) => {
    returnTo.current = from || null; setDraft(d); setSaid(null);
    setTimeout(() => {
      editorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      // Read only: the editor itself takes focus, so it's read out.
      const first = canEdit ? (editorRef.current?.querySelector('input') as HTMLInputElement | null) : null;
      (first || editorRef.current)?.focus();
    }, 60);
  };
  const close = (gone = false) => {
    setDraft(null);
    // Back to the button that opened it, or to the list when that reply has gone (hidden or removed).
    const id = gone ? '' : returnTo.current;
    setTimeout(() => (document.getElementById(id || '') || document.getElementById('ready-replies'))?.focus(), 30);
  };
  const run = async (key: string, body: any, ok: string) => {
    setBusy(key); setSaid(null);
    const r = await post({ tenantId, ...body });
    setBusy('');
    if (!r.ok) { setSaid({ text: r.error || 'That didn’t save. Try again.', bad: true }); return false; }
    setSaid({ text: ok }); return true;
  };
  const insert = (token: string) => {
    if (!draft) return;
    const el = textRef.current; const at = el ? el.selectionStart ?? draft.text.length : draft.text.length; const end = el ? el.selectionEnd ?? at : at;
    const next = draft.text.slice(0, at) + token + draft.text.slice(end);
    setDraft({ ...draft, text: next });
    setTimeout(() => { if (el) { el.focus(); el.setSelectionRange(at + token.length, at + token.length); } }, 0);
  };
  const save = async () => {
    if (!draft) return;
    if (await run('save', { action: 'save', id: draft.id, situation: draft.situation, name: draft.name, text: draft.text }, draft.id ? 'Saved. The team sees the new wording now.' : 'Added. The team can pick it now.')) close();
  };

  const auto = AUTOMATIC_KINDS.map((k) => {
    const def = MESSAGE_KIND_BY_ID[k]; if (!def) return null;
    const p = resolveMessagePolicy(tenant, k, 'email');
    return { id: k, label: def.label, canDisable: def.canDisable, on: p.enabled, custom: p.custom, text: plain(p.custom && p.body ? p.body : String(def.defaultBody || '')).replace(/^Hi \[first name\],?\s*/i, '') };
  }).filter(Boolean) as { id: string; label: string; canDisable: boolean; on: boolean; custom: boolean; text: string }[];

  const row = (r: Reply) => (
    <div key={r.id} className="flex items-center gap-3 py-3" style={{ borderTop: `1px solid ${C.line}` }}>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[15px] font-semibold">{r.name}{r.changed ? <span className="text-[12.5px] font-semibold" style={muted}> · reworded</span> : null}{!r.builtIn ? <span className="text-[12.5px] font-semibold" style={muted}> · yours</span> : null}</p>
        <p className="m-0 mt-0.5 truncate text-[13.5px]" style={muted}>{readable(r.text)}</p>
      </div>
      {r.hidden
        ? (canEdit && <Btn kind="soft" className="h-10" disabled={busy === `show-${r.id}`} onClick={() => void run(`show-${r.id}`, { action: 'show', id: r.id }, `${r.name} is back in the reply boxes.`)}>{busy === `show-${r.id}` ? 'Bringing back…' : 'Bring back'}</Btn>)
        : <button id={`edit-${r.id}`} type="button" aria-label={`${canEdit ? 'Edit' : 'View'} ${r.name}`} onClick={() => open({ id: r.id, situation: r.situation, name: r.name, text: r.text }, `edit-${r.id}`)} className="h-11 shrink-0 px-1 text-[14px] font-semibold underline underline-offset-[3px]">{canEdit ? 'Edit' : 'View'}</button>}
    </div>);

  const editing = draft ? all.find((r) => r.id === draft.id) : null;
  const editor = draft && (
    <div ref={editorRef} tabIndex={-1} role="region" aria-label={draft.id ? `${canEdit ? 'Editing' : 'Reply'}: ${draft.name || 'a reply'}` : 'A new reply'} className="space-y-3 p-5 outline-none" style={{ ...box, borderRadius: 22 }}>
      <p className="m-0 text-[13px] font-semibold" style={muted}>{draft.id ? (canEdit ? 'Editing' : 'Reply') : 'A new reply'}</p>
      <fieldset disabled={!canEdit} className="m-0 space-y-3 border-0 p-0">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold" style={muted}>Name
          <input value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="h-11 rounded-xl border px-3 text-[15px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }} /></label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold" style={muted}>Offered when
          <select value={draft.situation} disabled={!!editing?.builtIn || !canEdit} onChange={(e) => setDraft({ ...draft, situation: e.target.value as ReplySituation })} className="h-11 rounded-xl border px-2.5 text-[15px] font-normal" style={{ borderColor: C.line, background: C.paper, color: C.ink }}>
            {SITUATIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select></label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold" style={muted}>Wording
          <textarea ref={textRef} value={draft.text} maxLength={800} rows={5} onChange={(e) => setDraft({ ...draft, text: e.target.value })} className="resize-y rounded-2xl border px-3 py-2.5 text-[15px] font-normal leading-snug" style={{ borderColor: C.line, background: C.paper, color: C.ink }} /></label>
        {canEdit && <div role="group" aria-label="Add a detail from the order" className="flex flex-wrap gap-1.5">
          {tokensFor(draft.situation).map((x) => <button key={x.key} type="button" onClick={() => insert(x.token)} className="cf-press h-9 rounded-full px-3 text-[13px] font-semibold" style={{ background: C.soft, color: C.ink }}>+ {x.label}</button>)}
        </div>}
      </fieldset>
      <p className="m-0 text-[12.5px] leading-snug" style={muted}>Details fill in from the order. The team can change the words before sending, and what they sent is kept on the order.</p>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Btn kind="primary" className="h-11 flex-1" disabled={busy === 'save'} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : draft.id ? 'Save' : 'Add the reply'}</Btn>
          <Btn kind="soft" className="h-11" disabled={busy === 'save'} onClick={() => close()}>Cancel</Btn>
        </div>) : <Btn kind="soft" className="h-11 w-full" onClick={() => close()}>Close</Btn>}
      {canEdit && editing && (
        <div className="flex flex-wrap gap-x-4">
          {editing.builtIn && editing.changed && <button type="button" disabled={!!busy} onClick={async () => { if (await run('reset', { action: 'reset', id: editing.id }, `${BUILT_IN_REPLIES.find((b) => b.id === editing.id)?.name || 'It'} is back to its built-in wording.`)) close(); }} className="h-11 text-[14px] font-semibold underline underline-offset-[3px]">Back to the built-in wording</button>}
          {editing.builtIn && <button type="button" disabled={!!busy} onClick={async () => { if (await run('hide', { action: 'hide', id: editing.id }, `${editing.name} is hidden from the reply boxes. Bring it back any time.`)) close(true); }} className="h-11 text-[14px] font-semibold underline underline-offset-[3px]">Hide it from the team</button>}
          {!editing.builtIn && <button type="button" disabled={!!busy} onClick={async () => { if (await run('remove', { action: 'remove', id: editing.id }, `${editing.name} is removed.`)) close(true); }} className="h-11 text-[14px] font-semibold underline underline-offset-[3px]" style={{ color: C.bad }}>Remove</button>}
        </div>)}
    </div>);

  const hidden = all.filter((r) => r.hidden);
  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: C.paper, color: C.ink }}>
      <div className="mx-auto max-w-6xl px-4 pt-5">
        <LargeTitle title="Replies" sub={canEdit ? 'One set of wording for everyone, so customers hear the same thing whoever answers.' : 'The wording your team uses. Only people whose role runs the settings can change it.'} />
        <div className="mt-5 flex flex-wrap items-start gap-5">
          <div className="min-w-0 flex-[3_1_560px] space-y-3.5">
            <p className="m-0 text-[13px] font-semibold" style={muted}>Sent on their own</p>
            <div className="px-4 py-1" style={box}>
              {auto.map((a, i) => (
                <div key={a.id} className="flex items-center gap-3 py-3" style={i ? { borderTop: `1px solid ${C.line}` } : undefined}>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[15px] font-semibold">{a.label}{a.custom ? <span className="text-[12.5px] font-semibold" style={muted}> · your wording</span> : null}</p>
                    <p className="m-0 mt-0.5 truncate text-[13.5px]" style={muted}>{a.text}</p>
                  </div>
                  <Link href="/settings/messages?group=Retail" aria-label={`${canEdit ? 'Edit' : 'View'} the wording of ${a.label}`} className="h-11 shrink-0 content-center px-1 text-[14px] font-semibold underline underline-offset-[3px]" style={{ color: C.ink }}>{canEdit ? 'Edit' : 'View'}</Link>
                  {a.canDisable
                    ? <Toggle on={a.on} label={a.label} disabled={!canEdit || busy === `auto-${a.id}`} onChange={(v) => void run(`auto-${a.id}`, { action: 'auto', kind: a.id, on: v }, `${a.label} is ${v ? 'on' : 'off'}.`)} />
                    : <span className="w-12 shrink-0 text-center text-[12.5px]" style={muted}>Always</span>}
                </div>))}
            </div>
            <p className="m-0 text-[13px] leading-snug" style={muted}>Only acknowledgments and updates send on their own. A decision is always made by a person; its wording comes from here.</p>

            <div className="flex items-center justify-between gap-3 pt-3">
              <p id="ready-replies" tabIndex={-1} className="m-0 text-[13px] font-semibold outline-none" style={muted}>Ready replies, picked by the team</p>
              {canEdit && <Btn id="add-reply" kind="soft" className="h-11" onClick={() => open({ id: null, situation: 'message', name: '', text: '' }, 'add-reply')}>Add a reply</Btn>}
            </div>
            {stored === null && <p role="status" className="m-0 py-6 text-[15px]" style={muted}>Loading replies…</p>}
            {stored === false && <p role="alert" className="m-0 py-6 text-[15px]" style={{ color: C.warn }}>The replies couldn’t be loaded. Refresh the page to try again.</p>}
            {Array.isArray(stored) && SITUATIONS.map((s) => {
              const list = all.filter((r) => r.situation === s.id && !r.hidden);
              return (
                <section key={s.id} aria-label={s.label} className="px-4 pb-1 pt-3" style={box}>
                  <p className="m-0 pb-2 text-[13px] font-semibold">{s.label}</p>
                  {list.length ? list.map(row) : <p className="m-0 py-3 text-[14px]" style={{ ...muted, borderTop: `1px solid ${C.line}` }}>None. {canEdit ? 'Add one above.' : ''}</p>}
                </section>);
            })}
            {hidden.length > 0 && (
              <section aria-label="Hidden from the team" className="px-4 pb-1 pt-3" style={box}>
                <p className="m-0 pb-2 text-[13px] font-semibold" style={muted}>Hidden from the team</p>
                {hidden.map(row)}
              </section>)}
          </div>
          <aside className="min-w-0 flex-[1_1_340px] space-y-3.5" aria-label="Edit a reply">
            {editor || (
              <div className="space-y-1.5 p-4" style={box}>
                <p className="m-0 text-[13px] font-semibold" style={muted}>How replies work</p>
                <p className="m-0 text-[14px] leading-snug">They show as buttons above the reply box when someone answers a customer’s message, asks for something on a claim or declines one. One tap fills in the words from the order; nothing sends until they press Send.</p>
              </div>)}
            <p role="status" aria-live="polite" className={said && !said.bad ? 'm-0 px-1 text-[13.5px]' : 'sr-only'} style={{ color: C.ok }}>{said && !said.bad ? said.text : ''}</p>
            <p role="alert" className={said?.bad ? 'm-0 px-1 text-[13.5px]' : 'sr-only'} style={{ color: C.warn }}>{said?.bad ? said.text : ''}</p>
          </aside>
        </div>
      </div>
    </div>);
}
