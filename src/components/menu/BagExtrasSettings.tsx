'use client';
// src/components/menu/BagExtrasSettings.tsx — WHAT'S TICKED INTO THE BAG, on the Menu page under "Scan bags before
// they're handed over" (lib/bag-extras; api/menu 'laneSettings' bagGroups and bagExtras; design board "The extras in the
// bag, and what got caught", A). Two lists to pick from, each saved as it's tapped:
//   - the choices on the menu whose picks go in the bag on their own (Dips, Sauces): each one a guest picks is ticked in,
//     counted;
//   - the business's own extras, as set on Food cost (napkins with each order to go, a straw with each cold drink).
// The list for each order is made from these; the team taps each in at the handover, with the bags.
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';

const INK = '#16171a', MUTED = '#6d7075', LINE = '#ececee', GREEN = '#1f7a4d', AMBER = '#b45309';
const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#16171a] focus-visible:ring-offset-2';

export type BagExtrasSet = { groups: string[]; extras: string[]; plate: { id: string; name: string; words: string }[] };

function Chip({ on, busy, onClick, children }: { on: boolean; busy: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} aria-disabled={busy} onClick={() => { if (!busy) onClick(); }}
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-left text-[14px] font-semibold aria-disabled:opacity-50 ${RING}`}
      style={on ? { background: INK, color: '#fff' } : { background: '#fff', color: INK, boxShadow: `inset 0 0 0 1px ${LINE}` }}>
      {on ? <Check aria-hidden size={15} strokeWidth={2.5} /> : null}{children}
    </button>);
}

export function BagExtrasSettings({ start, menuGroups, call, scanning }: { start: BagExtrasSet; menuGroups: string[]; call: (body: any) => Promise<any>; scanning: boolean }) {
  const [groups, setGroups] = useState<string[]>(start.groups); const [extras, setExtras] = useState<string[]>(start.extras);
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<{ text: string; tone: 'good' | 'warn' } | null>(null);
  const has = (list: string[], v: string) => list.some((x) => x.toLowerCase() === v.toLowerCase());
  // (The menu's choices, and any picked before that's not on the menu now, so it can be taken off.)
  const names = Array.from(new Map([...menuGroups, ...groups].map((g) => [g.toLowerCase(), g])).values()).sort((a, b) => a.localeCompare(b));
  const save = async (k: string, body: { bagGroups?: string[]; bagExtras?: string[] }, undo: () => void) => {
    setBusy(k); setMsg(null);
    const d = await call({ action: 'laneSettings', ...body }).catch(() => ({ ok: false, error: 'No connection. Try again.' })); setBusy(null);
    if (d.ok && d.lane?.bagExtras) { setGroups(d.lane.bagExtras.groups); setExtras(d.lane.bagExtras.extras); setMsg({ text: 'Saved. It’s on the next order to go.', tone: 'good' }); }
    else { undo(); setMsg({ text: d.error || 'That didn’t save. Try again.', tone: 'warn' }); }
  };
  const flipGroup = (g: string) => { const was = groups; const next = has(was, g) ? was.filter((x) => x.toLowerCase() !== g.toLowerCase()) : [...was, g]; setGroups(next); void save(`g:${g}`, { bagGroups: next }, () => setGroups(was)); };
  const flipExtra = (id: string) => { const was = extras; const next = was.includes(id) ? was.filter((x) => x !== id) : [...was, id]; setExtras(next); void save(`x:${id}`, { bagExtras: next }, () => setExtras(was)); };
  return (
    <div className="space-y-3 rounded-2xl p-3" style={{ background: '#f5f5f7' }}>
      <div>
        <p id="bag-extras" className="text-[15px] font-medium">What’s ticked into the bag</p>
        <p className="text-[13px]" style={{ color: MUTED }}>{scanning ? 'On each order to go, the team taps these in as they bag it, with the scan, and it’s handed over once they’re all in. Counted from the order: 2 ranch, 2 straws.' : 'With bags not scanned, these print on the first bag’s label to read, and nothing waits for them.'}</p>
      </div>
      <div role="group" aria-labelledby="bag-extras-groups" className="space-y-2">
        <p id="bag-extras-groups" className="text-[13.5px] font-semibold">What the guest picks from</p>
        {names.length ? <div className="flex flex-wrap gap-2">{names.map((g) => <Chip key={g} on={has(groups, g)} busy={busy !== null} onClick={() => flipGroup(g)}>{g}</Chip>)}</div>
          : <p className="text-[13px]" style={{ color: MUTED }}>Your menu has no choices yet. Add a choice like Dips to an item, and it shows here.</p>}
      </div>
      <div role="group" aria-labelledby="bag-extras-own" className="space-y-2">
        <p id="bag-extras-own" className="text-[13.5px] font-semibold">Your extras</p>
        {start.plate.length ? <div className="flex flex-wrap gap-2">{start.plate.map((e) => <Chip key={e.id} on={extras.includes(e.id)} busy={busy !== null} onClick={() => flipExtra(e.id)}><span>{e.name}<span className="block text-[12.5px] font-medium" style={{ opacity: 0.75 }}>{e.words}</span></span></Chip>)}</div>
          : <p className="text-[13px]" style={{ color: MUTED }}>No extras are set yet. Set them once on <Link href="/food-cost" className="font-semibold underline underline-offset-4" style={{ color: INK }}>Food cost</Link>, with what each costs: napkins for each order to go, a straw for each cold drink.</p>}
      </div>
      {msg && <p role={msg.tone === 'warn' ? 'alert' : 'status'} className="text-[13.5px] font-medium" style={{ color: msg.tone === 'warn' ? AMBER : GREEN }}>{msg.text}</p>}
    </div>);
}
