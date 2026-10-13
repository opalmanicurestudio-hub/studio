'use client';
// Practice a shift: choosing client voices, and checking that talking practice works end to end.
import type { ReactNode } from 'react';
import { Btn, INK, MUTED, LINE, SOFT, GREEN, AMBER, RED } from './parts';
import { PRESETS, accentKey, type Pick, type Preset, type VoiceOpt } from '@/lib/practice/voices';

const sheet = (narrow: boolean) => ({ position: 'fixed' as const, inset: 0, zIndex: 60, background: 'rgba(22,23,26,.35)', display: 'flex', alignItems: narrow ? 'flex-end' : 'center', justifyContent: 'center', padding: narrow ? 0 : 24 });
const card = (narrow: boolean, w: number) => ({ background: '#fff', borderRadius: narrow ? '22px 22px 0 0' : 22, width: narrow ? '100%' : w, maxHeight: narrow ? '88vh' : '86vh', overflow: 'auto', padding: 18, boxSizing: 'border-box' as const, display: 'flex', flexDirection: 'column' as const, gap: 12, boxShadow: '0 40px 80px -40px rgba(0,0,0,.6)' });
const Head = ({ title, sub, onClose }: { title: string; sub: string; onClose: () => void }) => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
    <div style={{ flex: 1 }}><div style={{ fontSize: 20, fontWeight: 300 }}>{title}</div><div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{sub}</div></div>
    <Btn small ghost onClick={onClose}>Done</Btn>
  </div>
);
const tag = (t: string): ReactNode => <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 999, background: SOFT, color: INK, fontWeight: 600, textTransform: 'capitalize' }}>{t}</span>;

export type VoicePerson = { id: string; name: string; role: 'desk' | 'call'; line: string };
export function VoicePicker(p: {
  narrow: boolean; people: VoicePerson[]; options: VoiceOpt[]; picks: Record<string, Pick>; preset: Preset; real: boolean;
  phone: boolean; onPhone: (on: boolean) => void; onPreset: (k: Preset) => void; onPick: (id: string, pick: Pick) => void; onPreview: (id: string) => void; onClose: () => void;
}) {
  const label = (v: VoiceOpt) => `${v.name} · ${[v.accent && accentKey(v.accent) !== 'american' ? v.accent : v.accent ? 'American' : '', v.gender, v.age.replace(/_/g, ' ')].filter(Boolean).join(', ')}`;
  return (
    <div style={sheet(p.narrow)} onClick={p.onClose}>
      <div style={card(p.narrow, 640)} onClick={(e) => e.stopPropagation()}>
        <Head title="Client voices" sub={p.real ? 'Real voices from your voice account. Different accents, ages and speeds help everyone practice understanding all kinds of clients.' : 'This device’s own voices. Connect real voices for natural-sounding clients with more accents.'} onClose={p.onClose} />
        <div style={{ display: 'grid', gridTemplateColumns: p.narrow ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 6 }}>
          {PRESETS.map((x) => <button key={x.key} onClick={() => p.onPreset(x.key)} style={{ textAlign: 'left', border: `1px solid ${p.preset === x.key ? INK : LINE}`, background: p.preset === x.key ? INK : '#fff', color: p.preset === x.key ? '#fff' : INK, borderRadius: 14, padding: '9px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{x.label}</div><div style={{ fontSize: 11, opacity: 0.75, marginTop: 2, lineHeight: 1.35 }}>{x.note}</div></button>)}
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={p.phone} onChange={(e) => p.onPhone(e.target.checked)} />Callers sound like they’re on a phone line{!p.real && <span style={{ color: MUTED, fontSize: 11.5 }}>(real voices only)</span>}</label>
        {!p.options.length && <div style={{ fontSize: 13, color: AMBER }}>No voices found yet. {p.real ? 'Check your voice account has voices in it.' : 'Your browser hasn’t loaded its voices; try again in a moment.'}</div>}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {p.people.map((person) => { const pick = p.picks[person.id]; const v = p.options.find((o) => o.id === pick?.id);
            return <div key={person.id} style={{ display: 'grid', gridTemplateColumns: p.narrow ? '1fr' : '150px 1fr auto', gap: 8, alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${LINE}` }}>
              <div><div style={{ fontSize: 13.5, fontWeight: 700 }}>{person.role === 'call' ? '📞 ' : ''}{person.name}</div><div style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{person.line}”</div></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                <select aria-label={`Voice for ${person.name}`} value={pick?.id || ''} onChange={(e) => { const o = p.options.find((x) => x.id === e.target.value); if (o) p.onPick(person.id, { src: o.src, id: o.id, speed: pick?.speed || 1 }); }} style={{ fontSize: 12.5, border: `1px solid ${LINE}`, borderRadius: 10, padding: '6px 8px', background: '#fff', color: INK, width: '100%' }}>
                  {!p.options.length && <option value="">This device’s default voice</option>}
                  {p.options.map((o) => <option key={o.id} value={o.id}>{label(o)}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {v?.accent && tag(v.accent)}{v?.description && tag(v.description)}
                  <span style={{ fontSize: 11, color: MUTED, marginLeft: 'auto' }}>Pace</span>
                  {([[0.85, 'Slow'], [1, 'Normal'], [1.15, 'Fast']] as const).map(([sp, l]) => <button key={l} onClick={() => pick && p.onPick(person.id, { ...pick, speed: sp })} style={{ border: `1px solid ${Math.abs((pick?.speed || 1) - sp) < 0.08 ? INK : LINE}`, background: Math.abs((pick?.speed || 1) - sp) < 0.08 ? INK : '#fff', color: Math.abs((pick?.speed || 1) - sp) < 0.08 ? '#fff' : INK, borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{l}</button>)}
                </div>
              </div>
              <Btn small ghost onClick={() => p.onPreview(person.id)}>▶ Hear</Btn>
            </div>; })}
        </div>
        {p.real && <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>Want more accents? Add voices from the Voice Library in your voice account (for example British, Indian, Nigerian, Irish, Australian, Southern US, Spanish-accented English). They show up here automatically.</div>}
      </div>
    </div>
  );
}

export type CheckRow = { label: string; ok: boolean | null; detail: string; action?: { label: string; run: () => void; busy?: boolean } };
export function VoiceCheck({ narrow, rows, level, onClose }: { narrow: boolean; rows: CheckRow[]; level: number; onClose: () => void }) {
  const firstBad = rows.find((r) => r.ok === false);
  return (
    <div style={sheet(narrow)} onClick={onClose}>
      <div style={card(narrow, 520)} onClick={(e) => e.stopPropagation()}>
        <Head title="Voice check" sub="Runs each step of a conversation, so you can see exactly where it stops." onClose={onClose} />
        <div style={{ borderRadius: 14, padding: '10px 12px', background: firstBad ? '#fdf1e3' : '#e8f3ec', color: firstBad ? AMBER : GREEN, fontSize: 13, fontWeight: 600 }}>
          {firstBad ? `Start here (${firstBad.label}): ${firstBad.detail}` : rows.every((r) => r.ok) ? 'Everything works. Start talking.' : 'So far so good. Run the tests below.'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((r, i) => <div key={r.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderTop: i ? `1px solid ${LINE}` : 'none' }}>
            <span style={{ width: 22, height: 22, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', background: r.ok === true ? GREEN : r.ok === false ? RED : '#c9cbd0' }}>{r.ok === true ? '✓' : r.ok === false ? '!' : i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{r.label}</div>
              <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2, lineHeight: 1.45, wordBreak: 'break-word' }}>{r.detail}</div>
              {r.label === 'Microphone' && <div style={{ height: 6, background: SOFT, borderRadius: 3, marginTop: 6, overflow: 'hidden' }}><div style={{ width: `${Math.min(100, level * 900)}%`, height: '100%', background: level > 0.02 ? GREEN : AMBER, transition: 'width .08s' }} /></div>}
            </div>
            {r.action && <Btn small ghost onClick={r.action.run} disabled={r.action.busy}>{r.action.busy ? 'Working…' : r.action.label}</Btn>}
          </div>)}
        </div>
      </div>
    </div>
  );
}
