'use client';
// src/app/barback/[tenantId]/page.tsx — THE BARBACK (design canvas "Dish and barback"; lib/barback, lib/back-calls,
// api/back). The barback's phone, or a tablet behind the bar.
//   Asked for: what the bartenders called for (the kitchen screen's Call, set to the bar), longest waiting first, with
//     "On my way" and "Done". A chime for each new one.
//   Running low at the bar: kegs and bottles the bar's drinks pour from, with a few pours left in the open one or about
//     to run out at the last hour's pace; how many full ones are in stock; "Changed it" when one's swapped (a little left
//     by the count is logged as pour loss, with an Undo for a few minutes; it needs a PIN on a shared tablet). Something
//     changed that wasn't on the list can be said too.
//   Call dish (glasses, mostly), and Closing (the bar's closing items and anyone's).
import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { ClosingSheet } from '@/components/kitchen/ClosingSheet';
import { CallSheet, CallStrip } from '@/components/kitchen/CallSheet';
import { CallList, type QueueCall } from '@/components/back/CallList';
import { AMBER, AMBER_TINT, GREEN, GREEN_TINT, INK, LINE, MUTED, SOFT, PinSheet, Setup, Sheet, SheetHead, btn, clockOf, first, ring, useBackScreen } from '@/components/back/screen-kit';
import type { Call } from '@/lib/back-calls';

type Low = { id: string; name: string; kind: 'keg' | 'bottle' | 'other'; state: 'out' | 'last' | 'change'; poursLeft: number; minutesLeft: number | null; full: number; words: string };
type Bar = { bar: string | null; low: Low[]; fine: number; all: { id: string; name: string; kind: string }[]; drinksLastHour: number; rush: string | null };
type Data = { me: string; screen: string; business: { name: string }; staff: { id: string; name: string } | null; signedIn: boolean; calls: QueueCall[]; mine: Call[]; bar: Bar; now: string };

const STATE: Record<Low['state'], { label: string; bg: string; fg: string }> = {
  out: { label: 'Out', bg: AMBER, fg: '#fff' }, last: { label: 'The last of it', bg: AMBER_TINT, fg: AMBER }, change: { label: 'Get the next one ready', bg: SOFT, fg: INK },
};

function ChangeSheet({ all, onClose, onPick, busy }: { all: Bar['all']; onClose: () => void; onPick: (id: string) => void; busy: boolean }) {
  return (
    <Sheet label="Changed a keg or bottle" onClose={onClose}>
      <SheetHead title="Changed a keg or bottle" line="Which one did you change?" onClose={onClose} />
      <ul className="space-y-1.5">{all.map((p) => (
        <li key={p.id}><button type="button" disabled={busy} onClick={() => onPick(p.id)} className={`w-full min-h-[52px] rounded-2xl px-4 text-left text-[15.5px] font-semibold disabled:opacity-50 ${ring}`} style={{ background: SOFT }}>{p.name}</button></li>))}</ul>
    </Sheet>
  );
}

export default function BarbackScreen() {
  const { tenantId } = useParams() as { tenantId: string };
  const s = useBackScreen<Data>(tenantId, 'barback', (d) => d.calls.filter((c) => c.status === 'open').map((c) => c.id));
  const [pinOpen, setPinOpen] = useState(false); const [callOpen, setCallOpen] = useState(false); const [closingOpen, setClosingOpen] = useState(false); const [changeOpen, setChangeOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); const [notice, setNotice] = useState<{ text: string; good: boolean; undo?: string } | null>(null);
  // A change waiting for a PIN: made as soon as someone enters theirs.
  const [waiting, setWaiting] = useState<string | null>(null);
  if (!s.started) return null;
  if (!s.mode) return <Setup tenantId={tenantId} title="Set up the barback screen" place="Barback" stopped={s.stopped} onPaired={s.paired} onMe={s.useMe}
    line="A manager sets a tablet behind the bar up once, or the barback uses their own phone. It shows what the bartenders need and what’s running low, and a PIN only puts a name on what they did." />;
  if (s.closed) return <main className="min-h-dvh flex items-center justify-center p-6" style={{ background: SOFT, color: INK }}><p className="max-w-sm text-center text-[16px]">{s.closed}</p></main>;
  const d = s.data;
  if (!d) return <main className="min-h-dvh flex items-center justify-center" style={{ background: SOFT }}><div className="h-8 w-8 rounded-full border-[3px] animate-spin" style={{ borderColor: LINE, borderTopColor: INK }} role="status" aria-label="Loading" /></main>;
  const working = s.mode === 'me' ? d.staff?.name : s.staff?.name; const b = d.bar;

  const step = async (c: QueueCall, st: 'coming' | 'done' | 'release') => {
    setBusy(`${c.id}${st}`); setNotice(null);
    const { status, d: r } = await s.act({ action: 'callStep', id: c.id, step: st });
    setBusy(null);
    if (!r.ok) setNotice({ text: status === 0 ? 'No connection. Try again in a moment.' : r.error || 'That didn’t go through.', good: false });
    else if (r.already && st === 'coming' && r.call?.takenById !== d.me) setNotice({ text: `${first(r.call?.takenBy) || 'Someone'} is already on the way.`, good: false });
  };
  const changed = async (id: string) => {
    setBusy(`ch${id}`); setNotice(null);
    const { status, d: r } = await s.act({ action: 'changed', itemId: id });
    setBusy(null); setChangeOpen(false);
    if (r.code === 'pin') { setWaiting(id); setPinOpen(true); return; }
    setNotice(r.ok ? { text: r.words, good: true, undo: !r.already && r.loss > 0 ? r.id : undefined } : { text: status === 0 ? 'No connection. Try again in a moment.' : r.error || 'That didn’t go through.', good: false });
  };
  const undo = async (id: string) => {
    setBusy('undo'); const { status, d: r } = await s.act({ action: 'undoChange', id }); setBusy(null);
    setNotice(r.ok ? { text: r.words, good: true } : { text: status === 0 ? 'No connection. Try again in a moment.' : r.error || 'That didn’t go through.', good: false });
  };
  const top = [working ? `${first(working)} is working.` : d.business.name, b.bar ? `${b.drinksLastHour} ${b.drinksLastHour === 1 ? 'drink' : 'drinks'} in the last hour.` : '', b.rush ? `The rush: ${b.rush}.` : ''].filter(Boolean).join(' ');

  return (
    <div className="min-h-dvh" style={{ background: SOFT, color: INK }}>
      <header className="bg-[#fff] px-4 sm:px-6 py-3" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><h1 className="text-[22px] font-semibold leading-tight">Barback</h1><p className="text-[13.5px]" style={{ color: MUTED }}>{top}</p></div>
          <div className="flex flex-wrap gap-2">
            {s.mode === 'key' && <button type="button" onClick={() => (s.staff ? s.setStaff(null) : setPinOpen(true))} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}` }}>{s.staff ? `Not ${first(s.staff.name)}?` : 'Who’s working?'}</button>}
            <button type="button" onClick={() => setCallOpen(true)} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}` }}>Call dish</button>
            <button type="button" onClick={() => setClosingOpen(true)} className={btn} style={{ background: '#fff', border: `1px solid ${LINE}` }}>Closing</button>
          </div>
        </div>
        {(!s.soundOk || (s.lastOk && Date.now() - s.lastOk > 30000)) && <p className="mt-2 text-[13px]" style={{ color: AMBER }} role="status">{s.lastOk && Date.now() - s.lastOk > 30000 ? `No connection since ${clockOf(new Date(s.lastOk).toISOString())}. It keeps trying.` : 'Tap anywhere to turn the sound on.'}</p>}
        {notice && <div role={notice.good ? 'status' : 'alert'} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl pl-3 pr-1 py-1 text-[14px]" style={notice.good ? { background: GREEN_TINT, color: GREEN } : { background: AMBER_TINT, color: AMBER }}>
          <span className="py-1">{notice.text}</span>
          {notice.undo && <button type="button" disabled={busy === 'undo'} onClick={() => void undo(notice.undo!)} className={`${btn} px-3`} style={{ color: INK }}>Undo</button>}</div>}
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 p-4 sm:p-6 lg:grid-cols-2">
        <section aria-labelledby="asked-title" className="space-y-2">
          <h2 id="asked-title" className="text-[17px] font-semibold">Asked for</h2>
          <CallList calls={d.calls} me={{ id: d.me, name: working || null }} busy={!!busy} onStep={(c, st) => void step(c, st)} empty="Nothing asked for. What the bar calls for shows here, with a chime." />
          {d.mine.length > 0 && <div className="pt-2"><p className="mb-1.5 text-[13.5px] font-semibold" style={{ color: MUTED }}>You asked</p><CallStrip calls={d.mine} post={(x) => s.act(x)} now={s.now} onChanged={() => void s.load(true)} /></div>}
        </section>

        <section aria-labelledby="low-title" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 id="low-title" className="text-[17px] font-semibold">Running low at the bar</h2>
            {b.all.length > 0 && <button type="button" onClick={() => setChangeOpen(true)} className={`${ring} min-h-[44px] text-[14px] font-semibold underline underline-offset-4`}>Changed something else?</button>}
          </div>
          {!b.bar ? <p className="rounded-2xl bg-[#fff] px-4 py-5 text-[15px]" style={{ color: MUTED }}>There’s no station called Bar yet. A manager can add one on the Menu page, under table service’s Stations.</p>
            : b.all.length === 0 ? <p className="rounded-2xl bg-[#fff] px-4 py-5 text-[15px]" style={{ color: MUTED }}>The bar’s drinks don’t have recipes with kegs or bottles yet. Add them on the Menu page to see what’s running low here.</p>
            : b.low.length === 0 ? <p className="rounded-2xl bg-[#fff] px-4 py-5 text-[15px]" style={{ color: MUTED }}>Nothing running low. {b.fine === 1 ? 'The one thing' : `All ${b.fine} things`} the bar pours from {b.fine === 1 ? 'looks' : 'look'} fine by the count.</p>
            : <ul className="space-y-2">{b.low.map((p) => {
              const st = STATE[p.state];
              return (
                <li key={p.id} className="rounded-2xl border p-4 space-y-2" style={p.state === 'change' ? { background: '#fff', borderColor: LINE } : { background: AMBER_TINT, borderColor: '#f3c99a' }}>
                  <div className="flex items-start justify-between gap-3"><p className="text-[17px] font-semibold leading-snug">{p.name}</p>
                    <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold" style={{ background: st.bg, color: st.fg }}>{st.label}</span></div>
                  <p className="text-[14.5px]">{p.words}</p>
                  {p.state === 'last' && <p className="text-[13.5px]" style={{ color: AMBER }}>The managers have been told.</p>}
                  {p.state !== 'out' && <button type="button" disabled={!!busy} onClick={() => void changed(p.id)} className={`${btn} w-full`} style={{ background: INK, color: '#fff' }}>{busy === `ch${p.id}` ? 'Saving…' : 'Changed it'}</button>}
                </li>
              );
            })}</ul>}
          {b.low.length > 0 && b.fine > 0 && <p className="text-[13.5px]" style={{ color: MUTED }}>{b.fine} more {b.fine === 1 ? 'looks' : 'look'} fine by the count.</p>}
        </section>
      </main>

      {pinOpen && <PinSheet onClose={() => { setPinOpen(false); setWaiting(null); }} onPin={async (pin) => { const e = await s.signIn(pin); if (!e) { setPinOpen(false); if (waiting) { const id = waiting; setWaiting(null); void changed(id); } } return e; }} />}
      {callOpen && <CallSheet only="dish" post={(x) => s.act(x)} station="Bar" onClose={() => setCallOpen(false)} onSent={(m) => setNotice({ text: m, good: true })} />}
      {changeOpen && <ChangeSheet all={b.all} busy={!!busy} onClose={() => setChangeOpen(false)} onPick={(id) => void changed(id)} />}
      {closingOpen && <ClosingSheet who="the bar" post={(body) => s.post('/api/back', { ...body, area: 'bar' })} onClose={() => setClosingOpen(false)} />}
    </div>
  );
}
