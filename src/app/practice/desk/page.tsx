'use client';
// Practice at the desk: refunds and filling cancellations from the waitlist, with no real clients or money
// (lib/practice/desk-drills). Each scene: the person in front of you, the paper you'd look at (a receipt or the
// waitlist), a few decisions, and why the right one is right. A wrong pick explains itself and lets you try again;
// only the first try counts toward the score. Progress stays on this device.
import { useEffect, useMemo, useState } from 'react';
import { DESK_DRILLS, drillBy, score, type Answer, type Drill, type Paper } from '@/lib/practice/desk-drills';
import { Backdrop, GLASS, GLASS_ROW, Wordmark, Icon } from '../register/studio';
import { Person, Say, INK, MUTED, GREEN, RED } from '../register/parts';

const KEY = 'cf_practice_desk';
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const load = (): Record<string, { right: number; asked: number }> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
const save = (v: any) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* a private window: progress just isn't kept */ } };

function PaperCard({ p }: { p: Paper }) {
  if (p.kind === 'receipt') { const total = p.lines.reduce((s, l) => s + l.price, 0);
    return (
      <div style={{ background: '#fff', color: INK, borderRadius: 14, padding: '14px 16px', boxShadow: '0 18px 40px -22px rgba(0,0,0,.6)', fontSize: 13.5, maxWidth: 360, width: '100%' }}>
        <div style={{ fontSize: 12, color: MUTED }}>{p.title}</div>
        <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>{p.lines.map((l, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span>{l.label}</span><span>{money(l.price)}</span></div>)}</div>
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #d8d8dc', display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>Total</span><span>{money(total)}</span></div>
        <div style={{ marginTop: 4, fontSize: 12.5, color: MUTED }}>Paid: {p.paid}{p.note ? ` · ${p.note}` : ''}</div>
      </div>); }
  return (
    <div style={{ background: '#fff', color: INK, borderRadius: 14, padding: '14px 16px', boxShadow: '0 18px 40px -22px rgba(0,0,0,.6)', fontSize: 13.5, maxWidth: 420, width: '100%' }}>
      <div style={{ fontSize: 12, color: MUTED }}>Open: {p.opening}</div>
      <div style={{ fontSize: 12, color: MUTED }}>Now: {p.now}</div>
      <div style={{ marginTop: 8, fontWeight: 700 }}>{p.title}</div>
      <div style={{ marginTop: 4, display: 'grid', gap: 6 }}>{p.people.map((x, i) => <div key={i} style={{ borderTop: i ? '1px solid #ececee' : undefined, paddingTop: i ? 6 : 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{x.name}</b>{x.since && <span style={{ color: MUTED, fontSize: 12 }}>since {x.since}</span>}</div>
        <div style={{ color: MUTED, fontSize: 12.5 }}>{x.wants}</div>{x.note && <div style={{ color: '#b45309', fontSize: 12.5, fontWeight: 600 }}>{x.note}</div>}</div>)}</div>
    </div>);
}

function Scene({ d, onDone }: { d: Drill; onDone: (answers: Answer[]) => void }) {
  const [step, setStep] = useState(0); const [picked, setPicked] = useState<number | null>(null); const [answers, setAnswers] = useState<Answer[]>([]); const [tried, setTried] = useState<number[]>([]);
  const s = d.steps[step]; const ch = picked === null ? null : s.choices[picked];
  const pick = (i: number) => { if (ch?.right) return; setPicked(i); setTried((t) => [...t, i]); setAnswers((a) => [...a, { drill: d.id, step, picked: i, right: !!s.choices[i].right }]); };
  const next = () => { if (step + 1 < d.steps.length) { setStep(step + 1); setPicked(null); setTried([]); } else onDone(answers); };
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ width: 120, height: 150, overflow: 'hidden', borderRadius: 18, ...GLASS, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}><Person look={d.who.look} size={150} mood={ch && !ch.right ? 0.45 : 0.85} /></div>
          <div style={{ display: 'grid', gap: 6 }}><span style={{ color: '#fff', fontSize: 12.5, fontWeight: 700 }}>{d.who.name}</span><Say>{d.hello}</Say></div>
        </div>
        <PaperCard p={d.paper} />
      </div>
      <div style={{ ...GLASS, borderRadius: 22, padding: 18, color: '#fff', display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.8 }}>{d.title} · {step + 1} of {d.steps.length}</div>
        <div style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.3 }}>{s.ask}</div>
        <div style={{ display: 'grid', gap: 8 }}>{s.choices.map((c, i) => { const was = tried.includes(i); const on = picked === i;
          return <button key={i} type="button" onClick={() => pick(i)} disabled={!!ch?.right || (was && !c.right)} style={{ ...GLASS_ROW, textAlign: 'left', borderRadius: 14, padding: '12px 14px', fontSize: 14.5, lineHeight: 1.35, cursor: 'pointer', minHeight: 48,
            ...(on && c.right ? { background: 'rgba(31,122,77,.85)', borderColor: '#7fd1a5' } : was && !c.right ? { opacity: 0.55, textDecoration: 'line-through' } : {}) }}>{c.text}</button>; })}</div>
        {ch && <div role="status" style={{ background: '#fff', color: ch.right ? GREEN : RED, borderRadius: 14, padding: '10px 14px', fontSize: 14, lineHeight: 1.4 }}>
          <b>{ch.right ? (tried.length === 1 ? 'Right.' : 'That’s it.') : 'Not quite.'}</b> <span style={{ color: INK }}>{ch.right ? s.why : `${ch.why} Try another.`}</span></div>}
        {ch?.right && <button type="button" onClick={next} style={{ height: 48, borderRadius: 999, background: '#fff', color: INK, fontWeight: 700, fontSize: 15 }}>{step + 1 < d.steps.length ? 'Next' : 'Finish'}</button>}
      </div>
    </div>);
}

export default function DeskPractice() {
  const [prog, setProg] = useState<Record<string, { right: number; asked: number }>>({}); const [open, setOpen] = useState<string | null>(null); const [done, setDone] = useState<{ d: Drill; r: ReturnType<typeof score>; misses: { ask: string; picked: string; right: string; why: string }[] } | null>(null);
  useEffect(() => { setProg(load()); }, []);
  const d = open ? drillBy(open) : null;
  const total = useMemo(() => Object.values(prog).reduce((s, p) => s + p.right * 10, 0), [prog]);
  const finish = (dr: Drill, answers: Answer[]) => {
    const r = score(answers); const firsts = dr.steps.map((s, i) => ({ s, a: answers.find((x) => x.step === i) }));
    const misses = firsts.filter((x) => x.a && !x.a.right).map((x) => ({ ask: x.s.ask, picked: x.s.choices[x.a!.picked].text, right: x.s.choices.find((c) => c.right)!.text, why: x.s.why }));
    const best = prog[dr.id]; const next = { ...prog, [dr.id]: !best || r.right > best.right ? { right: r.right, asked: r.asked } : best }; setProg(next); save(next); setDone({ d: dr, r, misses }); setOpen(null);
  };
  const groups: [string, string, 'refunds' | 'waitlist'][] = [['Refunds', 'What to give back, where it goes, and what to say', 'refunds'], ['Filling a cancellation', 'Who the waitlist offers it to, and how', 'waitlist']];
  return (
    <main style={{ position: 'relative', minHeight: '100dvh', fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', color: INK }}>
      <Backdrop />
      <div style={{ position: 'relative', maxWidth: 1040, margin: '0 auto', padding: '18px 16px 40px', display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <Wordmark h={34} />
          <div style={{ ...GLASS, borderRadius: 999, padding: '8px 14px', color: '#fff', fontSize: 13.5, fontWeight: 600 }}>{total} points · practice only, nothing is real</div>
        </div>
        {d ? <><button type="button" onClick={() => setOpen(null)} style={{ ...GLASS, justifySelf: 'start', borderRadius: 999, padding: '8px 14px', color: '#fff', fontSize: 13.5 }}>← All scenes</button><Scene key={d.id} d={d} onDone={(a) => finish(d, a)} /></>
        : done ? (
          <div style={{ ...GLASS, borderRadius: 22, padding: 20, color: '#fff', display: 'grid', gap: 12, maxWidth: 640 }}>
            <div style={{ fontSize: 13, opacity: 0.8 }}>{done.d.title}</div>
            <div style={{ fontSize: 28, fontWeight: 300 }}>{done.r.right} of {done.r.asked} right the first time</div>
            {done.misses.length === 0 ? <div style={{ fontSize: 14.5 }}>Clean. That’s exactly how it should go at the desk.</div>
              : done.misses.map((m, i) => <div key={i} style={{ background: '#fff', color: INK, borderRadius: 14, padding: '12px 14px', fontSize: 13.5, lineHeight: 1.45 }}>
                <b>{m.ask}</b><div style={{ color: RED }}>You picked: {m.picked}</div><div style={{ color: GREEN }}>Better: {m.right}</div><div style={{ color: MUTED }}>{m.why}</div></div>)}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" onClick={() => { setDone(null); setOpen(done.d.id); }} style={{ height: 46, padding: '0 18px', borderRadius: 999, background: '#fff', color: INK, fontWeight: 700 }}>Try it again</button>
              <button type="button" onClick={() => setDone(null)} style={{ ...GLASS_ROW, height: 46, padding: '0 18px', borderRadius: 999, fontWeight: 600 }}>All scenes</button></div>
          </div>)
        : <>
          <div style={{ color: '#fff' }}><h1 style={{ fontSize: 30, fontWeight: 300, margin: 0, letterSpacing: '-0.02em' }}>At the desk</h1><p style={{ margin: '4px 0 0', fontSize: 14, opacity: 0.9 }}>Short scenes for the moments that are hardest at first. Pick what you’d do; every answer explains itself.</p></div>
          {groups.map(([title, sub, g]) => <section key={g} style={{ ...GLASS, borderRadius: 22, padding: 16, color: '#fff', display: 'grid', gap: 10 }}>
            <div><div style={{ fontSize: 17, fontWeight: 600 }}>{title}</div><div style={{ fontSize: 13, opacity: 0.85 }}>{sub}</div></div>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))' }}>{DESK_DRILLS.filter((x) => x.group === g).map((x) => { const p = prog[x.id];
              return <button key={x.id} type="button" onClick={() => { setDone(null); setOpen(x.id); }} style={{ ...GLASS_ROW, textAlign: 'left', borderRadius: 16, padding: '12px 14px', display: 'grid', gap: 3, cursor: 'pointer' }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b style={{ fontSize: 14.5 }}>{x.title}</b>{p && <span style={{ fontSize: 12, color: p.right === p.asked ? '#7fd1a5' : '#fff' }}>{p.right}/{p.asked}</span>}</span>
                <span style={{ fontSize: 12.5, opacity: 0.85 }}>{x.sub}</span></button>; })}</div>
          </section>)}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <a href="/practice/register" style={{ ...GLASS, borderRadius: 999, padding: '10px 16px', color: '#fff', fontSize: 13.5, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="pay" size={16} />Practice checkout at the register</a>
            <a href="/practice" style={{ color: '#fff', fontSize: 13, opacity: 0.85 }}>← Practice a shift</a></div>
        </>}
      </div>
    </main>);
}
