'use client';
// src/components/klair/MenuAsk.tsx — "Ask Klair about the menu" for guests (lib/klair-menu): on the table's page and
// ordering ahead. Answers come from the business's recipes and allergen marks only; any answer about an allergen says to
// tell the server.
import * as React from 'react';
import { MAX_QUESTION, TELL_SERVER } from '@/lib/klair-menu';

type QA = { q: string; a: string; tell: boolean };
export type AskMenu = (q: string) => Promise<{ text: string; tell: boolean } | { error: string }>;
export function MenuAsk({ name, ask, tell = TELL_SERVER, colors = {} }: { name: string; ask: AskMenu; tell?: string; colors?: { accent?: string; soft?: string; ink?: string; muted?: string; line?: string; card?: string } }) {
  const c = { accent: 'var(--accent, #16171a)', soft: 'var(--soft, #f5f5f7)', ink: 'var(--ink, #16171a)', muted: 'var(--muted, #6d7075)', line: 'var(--line, #ececee)', card: 'var(--card, #fff)', ...colors };
  const [q, setQ] = React.useState(''); const [list, setList] = React.useState<QA[]>([]);
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState('');
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); const x = q.trim(); if (!x || busy) return;
    setBusy(true); setErr(''); const r = await ask(x); setBusy(false);
    if ('error' in r) { setErr(r.error); return; }
    setList((l) => [...l, { q: x, a: r.text, tell: r.tell }].slice(-4)); setQ('');
  };
  return (
    <div style={{ color: c.ink }}>
      <p className="text-[15px] font-semibold">Ask {name} about the menu</p>
      {list.length === 0 && <p className="mt-0.5 text-[13.5px]" style={{ color: c.muted }}>What’s in a dish, or whether it has an allergen.</p>}
      <div aria-live="polite" className="mt-2 space-y-2">
        {list.map((x, i) => (
          <div key={i} className="space-y-1.5">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-[14px]" style={{ background: c.accent, color: '#fff' }}>{x.q}</p>
            <p className="w-fit max-w-[92%] rounded-2xl rounded-bl-md px-3 py-2 text-[14px] leading-relaxed" style={{ background: c.soft, color: c.ink }}>{x.a}</p>
          </div>))}
      </div>
      {list.some((x) => x.tell) && <p className="mt-2 text-[13px]" style={{ color: c.muted }}>{tell}</p>}
      <form onSubmit={send} className="mt-3 flex items-center gap-2">
        <input aria-label={`Ask ${name} about the menu`} value={q} onChange={(e) => setQ(e.target.value.slice(0, MAX_QUESTION))} placeholder="Is the soup gluten-free?" enterKeyHint="send"
          className="h-12 min-w-0 flex-1 rounded-full px-4 text-[16px] outline-none" style={{ border: `1px solid ${c.line}`, background: c.card, color: c.ink }} />
        <button type="submit" disabled={busy || !q.trim()} className="h-12 shrink-0 rounded-full px-5 text-[15px] font-semibold disabled:opacity-50" style={{ background: c.accent, color: '#fff' }}>{busy ? 'Asking…' : 'Ask'}</button>
      </form>
      {err && <p role="alert" className="mt-2 text-[13.5px]" style={{ color: '#b45309' }}>{err}</p>}
    </div>
  );
}
