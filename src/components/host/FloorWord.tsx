'use client';
// src/components/host/FloorWord.tsx — WHAT THE KITCHEN TELLS THE FLOOR, on My tables and the host stand (design canvas
// "The bar and the pass"; lib/floor-word). Tonight's 86 list, and the kitchen's message with when and who. Nothing when
// there's neither.
import type { FloorWord as Word } from '@/lib/floor-word';
import { eightySixWords } from '@/lib/floor-word';

const INK = '#16171a', MUTED = '#6d7075', SOFT = '#f5f5f7', AMBER = '#b45309', AMBER_TINT = '#fff7ed';
const at12 = (iso: string) => { try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

export function FloorWord({ word, tight }: { word: Word | null | undefined; tight?: boolean }) {
  const list = word?.eightySix || []; const note = word?.note || null;
  if (!list.length && !note) return null;
  const pad = tight ? 'px-3 py-2' : 'px-4 py-3';
  return (
    <div className="grid gap-2" role="status" aria-label="From the kitchen">
      {list.length > 0 && <div className={`rounded-2xl ${pad}`} style={{ background: AMBER_TINT }}>
        <p className="text-[13px] font-semibold" style={{ color: AMBER }}>86 tonight</p>
        <p className="text-[14.5px] leading-snug" style={{ color: INK }}>{eightySixWords(list)}</p>
      </div>}
      {note && <div className={`rounded-2xl ${pad}`} style={{ background: SOFT }}>
        <p className="flex items-baseline justify-between gap-3 text-[13px] font-semibold" style={{ color: INK }}>From the kitchen<span className="font-normal" style={{ color: MUTED }}>{at12(note.at)}, {note.by.split(' ')[0]}</span></p>
        <p className="text-[14.5px] leading-snug" style={{ color: INK }}>{note.text}</p>
      </div>}
    </div>
  );
}
