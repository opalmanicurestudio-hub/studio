'use client';
// src/components/pos/desk/ProductionBoard.tsx — THE PRODUCTION BOARD. Everything behind the scenes in four bands, read
// left to right: NOW (do these first), PREPARE (what the next 90 minutes of visits need set out), IN PROCESS (everything
// on a timer — cleanses, sterilisers, washers, dryers, contact times — counting down), RESTOCK (fold, check, put away,
// top up). Jobs keep their one-tap actions; timers move items on by themselves and land back in NOW when they finish.
import * as React from 'react';
import { Ring } from '@/components/pos/desk/hk-ui';
import { useSeconds } from '@/components/pos/desk/LiveTimer';
import type { OpsTask } from '@/lib/attendant';
import type { SetVisit, SetItem } from '@/lib/setaside';

export interface Running { id: string; kind: 'cleanse' | 'cycle' | 'wash' | 'dry' | 'contact'; title: string; sub: string; startMs: number; minutes: number }
const LOOK: Record<Running['kind'], { color: string; label: string }> = {
  cleanse: { color: '#2E6F6A', label: 'Cleanse' }, cycle: { color: '#7A5C3A', label: 'Steriliser' }, wash: { color: '#164A86', label: 'Wash' }, dry: { color: '#C47F00', label: 'Dryer' }, contact: { color: '#6B21A8', label: 'Contact' } };
const hm = (v: number) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
const mmss = (s: number) => { const a = Math.max(0, Math.round(s)); return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`; };

function Band({ title, count, tone, children, hint }: { title: string; count: number; tone: 'red' | 'ink' | 'blue' | 'green'; children: React.ReactNode; hint: string }) {
  const c = { red: '#B42318', ink: '#17181A', blue: '#164A86', green: '#1F6B3A' }[tone];
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3 rounded-[26px] p-4" style={{ background: '#FBF9F6', border: '1px solid #ECE6DD' }}>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-[14px] font-[800] text-white" style={{ background: count ? c : '#CFC8BD' }}>{count}</span>
        <h3 className="text-[18px] font-[800] tracking-[-0.01em]" style={{ color: count ? c : '#17181A' }}>{title}</h3>
      </div>
      <p className="-mt-2 text-[12px]" style={{ color: '#8A847A' }}>{hint}</p>
      {children}
    </section>);
}

export function ProductionBoard({ now: nowList, restock, plan, running, card, staff, onSetOut, setOut = {} }: { now: OpsTask[]; restock: OpsTask[]; plan: { visits: SetVisit[] }; running: Running[]; card: (t: OpsTask) => React.ReactNode; staff: any[]; onSetOut?: (it: SetItem, v: SetVisit) => void; setOut?: Record<string, string> }) {
  const sec = useSeconds();
  const soon = plan.visits.filter((v) => v.items.length && v.startMs - sec < 90 * 60000).slice(0, 8);
  const nameOf = (id: string | null) => String(staff.find((m: any) => m.id === id)?.name || '').split(' ')[0];
  const timers = running;
  return (
    <div className="grid gap-4 xl:grid-cols-4 lg:grid-cols-2">
      <Band title="Now" count={nowList.length} tone="red" hint="Most urgent first — resets, cleanses, loads, requests">
        {nowList.length ? nowList.map((t) => <React.Fragment key={t.id}>{card(t)}</React.Fragment>) : <p className="rounded-[20px] border border-dashed p-4 text-[14px]" style={{ color: '#8A847A' }}>Nothing urgent.</p>}
      </Band>
      <Band title="Prepare" count={soon.length} tone="ink" hint="Set out for the next 90 minutes">
        {soon.length ? soon.map((v) => (
          <div key={v.visitId} className="rounded-[20px] bg-white p-3 shadow-[0_8px_22px_-16px_rgba(23,24,26,0.35)]" style={{ border: `1px solid ${v.ok ? '#ECE6DD' : '#F0C9C4'}` }}>
            <p className="text-[15px]"><b className="font-[800] tabular-nums">{hm(v.startMs)}</b> <span className="font-[700]">{v.clientName.split(' ')[0]}</span><span style={{ color: '#6A655D' }}>{nameOf(v.staffId) ? ` · ${nameOf(v.staffId)}` : ''}</span></p>
            <div className="mt-2 flex flex-wrap gap-1.5">{v.items.map((it, i) => { const ok = it.state === 'ready' || it.state === 'in_time'; const isOut = !!(it.refId && setOut[it.refId] === v.visitId);
              const style = { background: isOut ? '#EDE8E1' : it.state === 'ready' ? '#E3F3E7' : ok ? '#FDF1DC' : '#FBEAE8', color: isOut ? '#17181A' : it.state === 'ready' ? '#1F6B3A' : ok ? '#7A4A00' : '#B42318' };
              const body = <>{it.code || it.type}{isOut ? <span className="font-[500]">· set out ✓</span> : it.state === 'ready' ? (onSetOut ? <span className="font-[500]">· set out</span> : null) : <span className="font-[500]">· {it.note.replace(/\s?[AP]M\b/gi, '')}</span>}</>;
              return it.state === 'ready' && !isOut && onSetOut && it.refId
                ? <button key={i} type="button" onClick={() => onSetOut(it, v)} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-[700]" style={{ ...style, border: '1px dashed #1F6B3A' }}>{body}</button>
                : <span key={i} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-[700]" style={style}>{body}</span>; })}</div>
          </div>)) : <p className="rounded-[20px] border border-dashed p-4 text-[14px]" style={{ color: '#8A847A' }}>Nothing to set out in the next 90 minutes.</p>}
      </Band>
      <Band title="In process" count={timers.length} tone="blue" hint="On a timer — moves on by itself">
        <TimerGrid running={running} />
      </Band>
      <Band title="Restock" count={restock.length} tone="green" hint="Fold, check, put away, top up">
        {restock.length ? restock.map((t) => <React.Fragment key={t.id}>{card(t)}</React.Fragment>) : <p className="rounded-[20px] border border-dashed p-4 text-[14px]" style={{ color: '#8A847A' }}>Shelves are stocked.</p>}
      </Band>
    </div>);
}

/** Every running timer as a countdown ring (cleanses, steriliser cycles, washer, dryer, contact times), soonest first. */
export function TimerGrid({ running }: { running: Running[] }) {
  const sec = useSeconds();
  const timers = [...running].map((r) => ({ ...r, left: (r.startMs + r.minutes * 60000 - sec) / 1000 })).sort((a, b) => a.left - b.left);
  if (!timers.length) return <p className="rounded-[20px] border border-dashed p-4 text-[14px]" style={{ color: '#8A847A' }}>Nothing on a timer.</p>;
  return (
    <div className="grid grid-cols-2 gap-3">{timers.map((r) => { const L = LOOK[r.kind]; const done = r.left <= 0;
      return (
        <div key={r.id} className="flex flex-col items-center gap-1.5 rounded-[20px] bg-white p-3 text-center shadow-[0_8px_22px_-16px_rgba(23,24,26,0.35)]" style={{ border: '1px solid #ECE6DD' }}>
          <Ring value={done ? 1 : 1 - r.left / Math.max(1, r.minutes * 60)} size={96} color={L.color} done={done}>
            <span className="text-[18px] font-[800] tabular-nums" style={{ color: done ? '#1F6B3A' : '#17181A' }}>{done ? 'Done' : mmss(r.left)}</span>
            <span className="text-[10px] font-[700]" style={{ color: L.color }}>{L.label}</span>
          </Ring>
          <p className="text-[13px] font-[700] leading-tight">{r.title}</p>
          <p className="text-[11px] leading-tight" style={{ color: '#6A655D' }}>{r.sub}</p>
        </div>); })}</div>);
}
